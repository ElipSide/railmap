import asyncio
import json
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def as_text(value):
    return str(value or "").strip()


def emit_and_exit(payload, code=0, stream="stdout"):
    text = json.dumps(payload, ensure_ascii=False)
    if stream == "stderr":
        sys.stderr.write(text)
        sys.stderr.flush()
    else:
        sys.stdout.write(text)
        sys.stdout.flush()
    raise SystemExit(code)


async def main():
    try:
        raw = sys.stdin.read().strip()
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError as error:
        emit_and_exit(
            {"ok": False, "error": f"Invalid JSON input: {error}", "code": "BAD_INPUT_JSON"},
            code=1,
            stream="stderr",
        )

    prompt = as_text(payload.get("prompt"))
    notebook_id = as_text(payload.get("notebook_id") or os.getenv("NOTEBOOKLM_NOTEBOOK_ID"))
    storage_path = as_text(payload.get("storage_path") or os.getenv("NOTEBOOKLM_STORAGE_PATH"))
    timeout_sec = float(payload.get("timeout_sec") or os.getenv("NOTEBOOKLM_PYTHON_TIMEOUT_SEC") or 120)

    if not prompt:
        emit_and_exit(
            {"ok": False, "error": "prompt is required", "code": "MISSING_PROMPT"},
            code=1,
            stream="stderr",
        )

    if not notebook_id:
        emit_and_exit(
            {"ok": False, "error": "notebook_id is required", "code": "MISSING_NOTEBOOK_ID"},
            code=1,
            stream="stderr",
        )

    if storage_path and not Path(storage_path).exists():
        emit_and_exit(
            {
                "ok": False,
                "error": f"storage_state.json not found: {storage_path}",
                "code": "STORAGE_NOT_FOUND",
            },
            code=1,
            stream="stderr",
        )

    try:
        from notebooklm import NotebookLMClient
    except Exception as error:
        emit_and_exit(
            {
                "ok": False,
                "error": "Python package notebooklm-py is not installed. Run: pip install 'notebooklm-py[browser]'",
                "code": "MISSING_NOTEBOOKLM_PY",
                "details": str(error),
            },
            code=1,
            stream="stderr",
        )

    try:
        async with await NotebookLMClient.from_storage(
            path=storage_path or None,
            timeout=timeout_sec,
        ) as client:
            result = await client.chat.ask(notebook_id, prompt)

        references = []
        for ref in getattr(result, "references", []) or []:
            references.append(
                {
                    "source_id": getattr(ref, "source_id", None),
                    "cited_text": getattr(ref, "cited_text", None),
                    "start_char": getattr(ref, "start_char", None),
                    "end_char": getattr(ref, "end_char", None),
                    "chunk_id": getattr(ref, "chunk_id", None),
                    "citation_number": getattr(ref, "citation_number", None),
                }
            )

        emit_and_exit(
            {
                "ok": True,
                "provider": "notebooklm-py",
                "notebook_id": notebook_id,
                "storage_path": storage_path or None,
                "answer": getattr(result, "answer", "") or "",
                "conversation_id": getattr(result, "conversation_id", None),
                "turn_number": getattr(result, "turn_number", None),
                "references": references,
                "raw_response": getattr(result, "raw_response", None),
            }
        )
    except Exception as error:
        message = str(error)
        if "Run 'notebooklm login'" in message:
            message = f"{message} Copy or refresh storage_state.json, then try again."

        emit_and_exit(
            {
                "ok": False,
                "error": message,
                "code": error.__class__.__name__,
            },
            code=1,
            stream="stderr",
        )


if __name__ == "__main__":
    asyncio.run(main())
