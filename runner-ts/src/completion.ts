// Shell completion scripts, generated from the CLI's actual command and
// option definitions so they never drift from the implementation.

export interface CompletionModel {
  program: string;
  commands: { name: string; description: string; flags: string[] }[];
}

export function generateCompletion(model: CompletionModel, shell: string): string {
  switch (shell) {
    case "bash":
      return bash(model);
    case "zsh":
      return zsh(model);
    case "fish":
      return fish(model);
    default:
      throw new Error(`unknown shell "${shell}", expected bash, zsh or fish`);
  }
}

function bash(model: CompletionModel): string {
  const commandNames = model.commands.map((c) => c.name).join(" ");
  const cases = model.commands
    .map((c) => `    ${c.name}) opts="${c.flags.join(" ")}" ;;`)
    .join("\n");
  return `# bash completion for ${model.program}
# load with: source <(${model.program} completion bash)
_${model.program}_completions() {
  local cur cmd opts
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${commandNames}" -- "$cur") )
    return
  fi
  case "$cmd" in
${cases}
    *) opts="" ;;
  esac
  case "$cur" in
    -*) COMPREPLY=( $(compgen -W "$opts" -- "$cur") ) ;;
    *) COMPREPLY=( $(compgen -f -- "$cur") ) ;;
  esac
}
complete -F _${model.program}_completions ${model.program}
`;
}

function zsh(model: CompletionModel): string {
  const commandLines = model.commands
    .map((c) => `    '${c.name}:${c.description.replace(/'/g, "")}'`)
    .join("\n");
  const cases = model.commands
    .map(
      (c) =>
        `      ${c.name}) _arguments ${c.flags.map((f) => `'${f}'`).join(" ")} '*:file:_files' ;;`,
    )
    .join("\n");
  return `#compdef ${model.program}
# zsh completion for ${model.program}
# load with: ${model.program} completion zsh > "\${fpath[1]}/_${model.program}"
_${model.program}() {
  local -a commands
  commands=(
${commandLines}
  )
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  else
    case "$words[2]" in
${cases}
      *) _files ;;
    esac
  fi
}
_${model.program} "$@"
`;
}

function fish(model: CompletionModel): string {
  const lines = [
    `# fish completion for ${model.program}`,
    `# load with: ${model.program} completion fish > ~/.config/fish/completions/${model.program}.fish`,
    `complete -c ${model.program} -f`,
  ];
  for (const command of model.commands) {
    const description = command.description.replace(/'/g, "");
    lines.push(
      `complete -c ${model.program} -n __fish_use_subcommand -a ${command.name} -d '${description}'`,
    );
    for (const flag of command.flags) {
      const long = flag.startsWith("--") ? flag.slice(2) : undefined;
      const short = !flag.startsWith("--") && flag.startsWith("-") ? flag.slice(1) : undefined;
      const spec = long ? `-l ${long}` : `-s ${short}`;
      lines.push(
        `complete -c ${model.program} -n "__fish_seen_subcommand_from ${command.name}" ${spec}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
