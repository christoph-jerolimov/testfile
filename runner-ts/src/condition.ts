import { resolveTemplate, type Scopes } from "./template.js";

// Evaluates an `if` expression. Templates are resolved first (unknown
// references become ""), then the result is parsed as:
//
//   <value>              truthy check: "", "false", "0", "no", "off" are false
//   <left> == <right>    string equality (surrounding quotes are stripped)
//   <left> != <right>    string inequality
//   !<expression>        negation
//   a && b   a || b      conjunction / disjunction (&& binds tighter)
//   ( ... )              grouping
//
// Operands keep their spaces, so `${{ env.NAME }} == my project` still
// works; a value that contains a literal "&&", "||" or a parenthesis has
// to be quoted.
export function evaluateCondition(expression: string, scopes: Scopes, where: string): boolean {
  const resolved = resolveTemplate(expression, scopes, where, { lenient: true });
  return parseOr(resolved, where);
}

function parseOr(input: string, where: string): boolean {
  const parts = splitTopLevel(input, "||");
  if (parts.length > 1) return parts.some((part) => parseAnd(part, where));
  return parseAnd(parts[0], where);
}

function parseAnd(input: string, where: string): boolean {
  const parts = splitTopLevel(input, "&&");
  if (parts.length > 1) return parts.every((part) => parseUnary(part, where));
  return parseUnary(parts[0], where);
}

function parseUnary(input: string, where: string): boolean {
  let rest = input.trim();
  let negate = false;
  // "!=" belongs to the comparison, not to a negation
  while (rest.startsWith("!") && !rest.startsWith("!=")) {
    negate = !negate;
    rest = rest.slice(1).trim();
  }
  const inner = unwrapParens(rest);
  const result = inner !== undefined ? parseOr(inner, where) : parseComparison(rest);
  return negate ? !result : result;
}

function parseComparison(input: string): boolean {
  const rest = input.trim();
  const comparison = /^(.*?)\s*(==|!=)\s*(.*)$/s.exec(rest);
  if (comparison) {
    const left = unquote(comparison[1].trim());
    const right = unquote(comparison[3].trim());
    return comparison[2] === "==" ? left === right : left !== right;
  }
  return truthy(rest);
}

// Splits on an operator that is neither inside quotes nor inside
// parentheses; returns [input] when the operator does not occur.
function splitTopLevel(input: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && input.startsWith(operator, i)) {
      parts.push(input.slice(start, i));
      i += operator.length - 1;
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

// The contents of a fully parenthesized expression, or undefined when the
// input is not wrapped in one matching pair.
function unwrapParens(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return undefined;
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      // closes before the end: "(a) && (b)" is not a single group
      if (depth === 0 && i !== trimmed.length - 1) return undefined;
    }
  }
  return depth === 0 ? trimmed.slice(1, -1) : undefined;
}

const FALSY = new Set(["", "false", "0", "no", "off"]);

function truthy(value: string): boolean {
  return !FALSY.has(unquote(value.trim()).toLowerCase());
}

function unquote(value: string): string {
  const match = /^"(.*)"$/s.exec(value) ?? /^'(.*)'$/s.exec(value);
  return match ? match[1] : value;
}
