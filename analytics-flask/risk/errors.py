class RiskError(Exception):
    def __init__(self, code, status=503):
        self.code, self.status = code, status
        super().__init__(code)


class LostClaim(RiskError):
    def __init__(self):
        super().__init__("CLAIM_LOST", 409)
