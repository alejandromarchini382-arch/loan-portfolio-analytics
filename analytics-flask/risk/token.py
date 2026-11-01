"""Local operator command: print a short-lived development token, never log it."""
import argparse
from .auth import Auth, PERMISSIONS
from .config import Settings


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant",required=True)
    parser.add_argument("--permission",action="append",choices=sorted(PERMISSIONS))
    args=parser.parse_args()
    settings=Settings.from_env()
    auth=Auth.from_env(settings.tenants)
    print(auth.token(args.tenant,args.permission) if args.permission else auth.token(args.tenant))


if __name__ == "__main__": main()
