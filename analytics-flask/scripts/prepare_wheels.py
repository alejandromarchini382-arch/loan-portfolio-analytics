"""Optional secure fallback for Docker environments without the host's CA trust chain."""
from pathlib import Path
import subprocess
import sys


def main():
    base=Path(__file__).resolve().parents[1]
    result=subprocess.run([sys.executable,"-m","pip","download","--timeout","120","--retries","5",
        "--platform","manylinux2014_x86_64","--implementation","cp","--python-version","311","--abi","cp311",
        "--only-binary=:all:","--dest",str(base/"wheels"),"-r",str(base/"requirements.lock")])
    return result.returncode


if __name__=="__main__": raise SystemExit(main())
