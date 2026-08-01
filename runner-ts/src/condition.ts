import { resolveTemplate, type Scopes } from "./template.js";

// Evaluates an `if` expression. Supported forms (after ${{ ... }} templates
// are resolved; unknown references become ""):
//   <value>              truthy check: "", "false", "0", "no", "off" are false
//   <left> == <right>    string equality (surrounding quotes are stripped)
//   <left> != <right>    string inequality
//   !<expression>        negates the whole expression
export function evaluateCondition(expression: string, scopes: Scopes, where: string): boolean {
  const resolved = resolveTemplate(expression, scopes, where, { lenient: true }).trim();
  let negate = false;
  let rest = resolved;
  while (rest.startsWith("!")) {
    negate = !negate;
    rest = rest.slice(1).trim();
  }
  let result: boolean;
  const comparison = /^(.*?)\s*(==|!=)\s*(.*)$/s.exec(rest);
  if (comparison) {
    const left = unquote(comparison[1].trim());
    const right = unquote(comparison[3].trim());
    result = comparison[2] === "==" ? left === right : left !== right;
  } else {
    result = truthy(rest);
  }
  return negate ? !result : result;
}

const FALSY = new Set(["", "false", "0", "no", "off"]);

function truthy(value: string): boolean {
  return !FALSY.has(unquote(value).toLowerCase());
}

function unquote(value: string): string {
  const match = /^"(.*)"$/s.exec(value) ?? /^'(.*)'$/s.exec(value);
  return match ? match[1] : value;
}
