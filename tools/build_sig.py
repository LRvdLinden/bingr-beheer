#!/usr/bin/env python3
# Security M4: ondertekening van aangeleverde buildpakketten (Ed25519). Gebruikt door tools/seal_build.sh (tekenen, in de
# aanleverende repo) en tools/builds_process.sh (controleren, workflow Builds). Openbaar: geen sleutels hier, alleen de
# openbare sleutels per repo in tools/signers/<repo>.pub.pem en wie welk platform mag aanleveren (SIGNERS).
#   build_sig.py msg <meta.json>            -> te ondertekenen tekst op stdout (vast formaat, versie v1, UTF-8, LF)
#   build_sig.py signer <platform>          -> repo die dit platform mag aanleveren (owner/naam) op stdout
#   build_sig.py pub <platform>             -> pad van de openbare sleutel van die repo (leeg als er nog geen is)
import json, os, sys

SIGNERS = {
    "apple": "LRvdLinden/iptv-ios-appletv",
    "android": "LRvdLinden/bingr-android",
    "android-aab": "LRvdLinden/bingr-android",
    "tizen": "LRvdLinden/bingr-android",
    "windows": "LRvdLinden/bingr-windows",
    "beheer": "LRvdLinden/bingr-beheer",
}
HERE = os.path.dirname(os.path.abspath(__file__))

def msg(meta: dict) -> str:
    # alles wat het pakket bepaalt; source = de repo die tekende (GITHUB_REPOSITORY), commit = de gebouwde commit
    parts = ["bingr-build-v1", str(meta.get("platform", "")), str(meta.get("build", "")), str(meta.get("version", "")),
             str(meta.get("file", "")), str(meta.get("sha256", "")), str(meta.get("size", "")), str(meta.get("source", "")),
             str(meta.get("commit", ""))]
    if any("\n" in p for p in parts): raise SystemExit("ongeldige meta")
    return "\n".join(parts) + "\n"

def main():
    if len(sys.argv) < 3: raise SystemExit("gebruik: build_sig.py msg <meta.json> | signer <platform> | pub <platform>")
    cmd, arg = sys.argv[1], sys.argv[2]
    if cmd == "msg":
        # als bytes met LF: op Windows (Git Bash, python) zou tekstmodus er CRLF van maken en klopt de handtekening niet
        sys.stdout.buffer.write(msg(json.load(open(arg, encoding="utf-8"))).encode("utf-8"))
        sys.stdout.buffer.flush()
    elif cmd == "signer":
        print(SIGNERS.get(arg, ""))
    elif cmd == "pub":
        repo = SIGNERS.get(arg, "")
        p = os.path.join(HERE, "signers", repo.split("/")[-1] + ".pub.pem") if repo else ""
        print(p if p and os.path.isfile(p) and os.path.getsize(p) > 0 else "")
    else:
        raise SystemExit("onbekende opdracht")

if __name__ == "__main__":
    main()
