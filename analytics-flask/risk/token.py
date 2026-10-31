"""Local operator command: print a short-lived development token, never log it."""
import argparse
from .auth import Auth
from .config import Settings


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant",required=True)
    args=parser.parse_args()
    settings=Settings.from_env()
    print(Auth.from_env(settings.tenants).token(args.tenant))


if __name__ == "__main__": main()
