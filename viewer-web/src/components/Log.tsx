import React, { useEffect, useState } from "react";

// Fetches text lazily and renders it as a log block.
export function Log({ url }: { url: string }): React.ReactElement {
  const [text, setText] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    setText(undefined);
    fetch(url)
      .then((response) => (response.ok ? response.text() : `(no log: ${response.status})`))
      .then((body) => {
        if (alive) setText(body);
      })
      .catch(() => alive && setText("(failed to load the log)"));
    return () => {
      alive = false;
    };
  }, [url]);
  return <pre className="log">{text ?? "loading..."}</pre>;
}
