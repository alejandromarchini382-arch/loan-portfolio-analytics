-- SQL Server 2022. Run in the target database using sqlcmd -b.
-- Initial, non-destructive migration: reruns create missing objects, not repair drift.
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF SCHEMA_ID(N'analytics') IS NULL EXEC(N'CREATE SCHEMA analytics AUTHORIZATION dbo');

IF OBJECT_ID(N'analytics.Tenants', N'U') IS NULL
CREATE TABLE analytics.Tenants (
    TenantId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Tenants PRIMARY KEY,
    TenantName NVARCHAR(150) NOT NULL
);
IF OBJECT_ID(N'analytics.Divisions', N'U') IS NULL
CREATE TABLE analytics.Divisions (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    DivisionId UNIQUEIDENTIFIER NOT NULL,
    DivisionName NVARCHAR(100) NOT NULL,
    CONSTRAINT PK_Divisions PRIMARY KEY (TenantId, DivisionId),
    CONSTRAINT FK_Divisions_Tenant FOREIGN KEY (TenantId) REFERENCES analytics.Tenants(TenantId)
);
IF OBJECT_ID(N'analytics.LoanOfficers', N'U') IS NULL
CREATE TABLE analytics.LoanOfficers (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    LoanOfficerId UNIQUEIDENTIFIER NOT NULL,
    LoanOfficerName NVARCHAR(150) NOT NULL,
    CONSTRAINT PK_LoanOfficers PRIMARY KEY (TenantId, LoanOfficerId),
    CONSTRAINT FK_LoanOfficers_Tenant FOREIGN KEY (TenantId) REFERENCES analytics.Tenants(TenantId)
);
IF OBJECT_ID(N'analytics.Borrowers', N'U') IS NULL
CREATE TABLE analytics.Borrowers (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    BorrowerId UNIQUEIDENTIFIER NOT NULL,
    BorrowerName NVARCHAR(200) NOT NULL,
    BorrowerType VARCHAR(20) COLLATE Latin1_General_100_BIN2 NOT NULL,
    Industry NVARCHAR(100) NULL,
    BorrowerRiskRating VARCHAR(10) COLLATE Latin1_General_100_BIN2 NULL,
    CONSTRAINT PK_Borrowers PRIMARY KEY (TenantId, BorrowerId),
    CONSTRAINT FK_Borrowers_Tenant FOREIGN KEY (TenantId) REFERENCES analytics.Tenants(TenantId),
    CONSTRAINT CK_Borrowers_Type CHECK (BorrowerType IN ('INDIVIDUAL', 'CORPORATE') AND DATALENGTH(BorrowerType) = LEN(BorrowerType)),
    CONSTRAINT CK_Borrowers_Risk CHECK (BorrowerRiskRating IN ('HIGH', 'MEDIUM', 'LOW') AND DATALENGTH(BorrowerRiskRating) = LEN(BorrowerRiskRating))
);
IF OBJECT_ID(N'analytics.Loans', N'U') IS NULL
CREATE TABLE analytics.Loans (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    LoanId UNIQUEIDENTIFIER NOT NULL,
    LoanNumber NVARCHAR(50) NOT NULL,
    BorrowerId UNIQUEIDENTIFIER NOT NULL,
    DivisionId UNIQUEIDENTIFIER NULL,
    LoanOfficerId UNIQUEIDENTIFIER NULL,
    PrincipalAmount DECIMAL(18,2) NOT NULL,
    CurrentBalance DECIMAL(18,2) NOT NULL,
    InterestRate DECIMAL(7,4) NULL,
    Status VARCHAR(20) COLLATE Latin1_General_100_BIN2 NOT NULL,
    OriginationDate DATE NOT NULL,
    MaturityDate DATE NOT NULL,
    DaysPastDue INT NOT NULL,
    LastPaymentDate DATE NULL,
    CurrencyCode CHAR(3) COLLATE Latin1_General_100_BIN2 NOT NULL,
    SourceVersion BIGINT NOT NULL,
    UpdatedAtUtc DATETIME2(3) NOT NULL,
    CONSTRAINT PK_Loans PRIMARY KEY (TenantId, LoanId),
    CONSTRAINT UQ_Loans_Number UNIQUE (TenantId, LoanNumber),
    CONSTRAINT FK_Loans_Tenant FOREIGN KEY (TenantId) REFERENCES analytics.Tenants(TenantId),
    CONSTRAINT FK_Loans_Borrower FOREIGN KEY (TenantId, BorrowerId) REFERENCES analytics.Borrowers(TenantId, BorrowerId),
    CONSTRAINT FK_Loans_Division FOREIGN KEY (TenantId, DivisionId) REFERENCES analytics.Divisions(TenantId, DivisionId),
    CONSTRAINT FK_Loans_Officer FOREIGN KEY (TenantId, LoanOfficerId) REFERENCES analytics.LoanOfficers(TenantId, LoanOfficerId),
    CONSTRAINT CK_Loans_Status CHECK (Status IN ('ACTIVE', 'CLOSED', 'DEFAULTED') AND DATALENGTH(Status) = LEN(Status)),
    CONSTRAINT CK_Loans_Amounts CHECK (PrincipalAmount > 0 AND CurrentBalance >= 0),
    CONSTRAINT CK_Loans_DPD CHECK (DaysPastDue >= 0),
    CONSTRAINT CK_Loans_USD CHECK (CurrencyCode = 'USD'),
    CONSTRAINT CK_Loans_Version CHECK (SourceVersion > 0)
);
IF OBJECT_ID(N'analytics.PaymentHistory', N'U') IS NULL
CREATE TABLE analytics.PaymentHistory (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    PaymentId UNIQUEIDENTIFIER NOT NULL,
    LoanId UNIQUEIDENTIFIER NOT NULL,
    PaymentDate DATE NOT NULL,
    PaymentAmount DECIMAL(18,2) NOT NULL,
    IsLate BIT NOT NULL,
    PostedAtUtc DATETIME2(3) NOT NULL,
    CONSTRAINT PK_PaymentHistory PRIMARY KEY (TenantId, PaymentId),
    CONSTRAINT FK_PaymentHistory_Loan FOREIGN KEY (TenantId, LoanId) REFERENCES analytics.Loans(TenantId, LoanId),
    CONSTRAINT CK_PaymentHistory_Amount CHECK (PaymentAmount >= 0)
);
IF OBJECT_ID(N'analytics.LoanPortfolio', N'U') IS NULL
CREATE TABLE analytics.LoanPortfolio (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    LoanId UNIQUEIDENTIFIER NOT NULL,
    LoanNumber NVARCHAR(50) NOT NULL,
    BorrowerId UNIQUEIDENTIFIER NOT NULL,
    BorrowerName NVARCHAR(200) NOT NULL,
    BorrowerType VARCHAR(20) COLLATE Latin1_General_100_BIN2 NOT NULL,
    Industry NVARCHAR(100) NULL,
    BorrowerRiskRating VARCHAR(10) COLLATE Latin1_General_100_BIN2 NULL,
    PrincipalAmount DECIMAL(18,2) NOT NULL,
    CurrentBalance DECIMAL(18,2) NOT NULL,
    InterestRate DECIMAL(7,4) NULL,
    Status VARCHAR(20) COLLATE Latin1_General_100_BIN2 NOT NULL,
    Division NVARCHAR(100) NULL,
    LoanOfficer NVARCHAR(150) NULL,
    OriginationDate DATE NOT NULL,
    MaturityDate DATE NOT NULL,
    DaysPastDue INT NOT NULL,
    LastPaymentDate DATE NULL,
    CurrencyCode CHAR(3) COLLATE Latin1_General_100_BIN2 NOT NULL,
    SourceVersion BIGINT NOT NULL,
    LastSyncedUtc DATETIME2(3) NOT NULL,
    CONSTRAINT PK_LoanPortfolio PRIMARY KEY (TenantId, LoanId),
    CONSTRAINT UQ_LoanPortfolio_Number UNIQUE (TenantId, LoanNumber),
    CONSTRAINT FK_LoanPortfolio_Loan FOREIGN KEY (TenantId, LoanId) REFERENCES analytics.Loans(TenantId, LoanId),
    CONSTRAINT FK_LoanPortfolio_Borrower FOREIGN KEY (TenantId, BorrowerId) REFERENCES analytics.Borrowers(TenantId, BorrowerId),
    CONSTRAINT CK_LoanPortfolio_Status CHECK (Status IN ('ACTIVE', 'CLOSED', 'DEFAULTED') AND DATALENGTH(Status) = LEN(Status)),
    CONSTRAINT CK_LoanPortfolio_Type CHECK (BorrowerType IN ('INDIVIDUAL', 'CORPORATE') AND DATALENGTH(BorrowerType) = LEN(BorrowerType)),
    CONSTRAINT CK_LoanPortfolio_Risk CHECK (BorrowerRiskRating IN ('HIGH', 'MEDIUM', 'LOW') AND DATALENGTH(BorrowerRiskRating) = LEN(BorrowerRiskRating)),
    CONSTRAINT CK_LoanPortfolio_Amounts CHECK (PrincipalAmount > 0 AND CurrentBalance >= 0),
    CONSTRAINT CK_LoanPortfolio_DPD CHECK (DaysPastDue >= 0),
    CONSTRAINT CK_LoanPortfolio_USD CHECK (CurrencyCode = 'USD'),
    CONSTRAINT CK_LoanPortfolio_Version CHECK (SourceVersion > 0)
);
IF OBJECT_ID(N'analytics.RiskJob', N'U') IS NULL
CREATE TABLE analytics.RiskJob (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    JobId UNIQUEIDENTIFIER NOT NULL,
    JobType VARCHAR(30) COLLATE Latin1_General_100_BIN2 NOT NULL,
    Status VARCHAR(15) COLLATE Latin1_General_100_BIN2 NOT NULL,
    IdempotencyKey NVARCHAR(120) NULL,
    RunId UNIQUEIDENTIFIER NOT NULL,
    Attempts INT NOT NULL CONSTRAINT DF_RiskJob_Attempts DEFAULT 0,
    LeaseUntilUtc DATETIME2(3) NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL,
    StartedAtUtc DATETIME2(3) NULL,
    CompletedAtUtc DATETIME2(3) NULL,
    ProcessedLoans INT NOT NULL CONSTRAINT DF_RiskJob_Processed DEFAULT 0,
    TotalLoans INT NOT NULL,
    ErrorCode VARCHAR(60) NULL,
    CONSTRAINT PK_RiskJob PRIMARY KEY (TenantId, JobId),
    CONSTRAINT UQ_RiskJob_Run UNIQUE (TenantId, RunId),
    CONSTRAINT FK_RiskJob_Tenant FOREIGN KEY (TenantId) REFERENCES analytics.Tenants(TenantId),
    CONSTRAINT CK_RiskJob_Type CHECK (JobType = 'RECALCULATE_LOAN_RISK' AND DATALENGTH(JobType) = LEN(JobType)),
    CONSTRAINT CK_RiskJob_Status CHECK (Status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED') AND DATALENGTH(Status) = LEN(Status)),
    CONSTRAINT CK_RiskJob_Counts CHECK (Attempts >= 0 AND TotalLoans >= 0 AND ProcessedLoans BETWEEN 0 AND TotalLoans)
);
IF OBJECT_ID(N'analytics.RiskScoreStage', N'U') IS NULL
CREATE TABLE analytics.RiskScoreStage (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    RunId UNIQUEIDENTIFIER NOT NULL,
    LoanId UNIQUEIDENTIFIER NOT NULL,
    LoanRiskRating VARCHAR(10) COLLATE Latin1_General_100_BIN2 NOT NULL,
    PolicyVersion VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,
    InputSourceVersion BIGINT NOT NULL,
    DaysPastDueUsed INT NOT NULL,
    BalancePrincipalRatio DECIMAL(18,8) NOT NULL,
    LatePaymentsLastSix INT NOT NULL,
    PaymentRowsInspected INT NOT NULL,
    CalculatedAtUtc DATETIME2(3) NOT NULL,
    CONSTRAINT PK_RiskScoreStage PRIMARY KEY (TenantId, RunId, LoanId),
    CONSTRAINT FK_RiskScoreStage_Run FOREIGN KEY (TenantId, RunId) REFERENCES analytics.RiskJob(TenantId, RunId),
    CONSTRAINT FK_RiskScoreStage_Loan FOREIGN KEY (TenantId, LoanId) REFERENCES analytics.LoanPortfolio(TenantId, LoanId),
    CONSTRAINT CK_RiskScoreStage_Rating CHECK (LoanRiskRating IN ('HIGH', 'MEDIUM', 'LOW') AND DATALENGTH(LoanRiskRating) = LEN(LoanRiskRating)),
    CONSTRAINT CK_RiskScoreStage_Policy CHECK (PolicyVersion = 'risk-demo-v1' AND DATALENGTH(PolicyVersion) = LEN(PolicyVersion)),
    CONSTRAINT CK_RiskScoreStage_Inputs CHECK (InputSourceVersion > 0 AND DaysPastDueUsed >= 0 AND BalancePrincipalRatio >= 0),
    CONSTRAINT CK_RiskScoreStage_Payments CHECK (PaymentRowsInspected BETWEEN 0 AND 6 AND LatePaymentsLastSix BETWEEN 0 AND PaymentRowsInspected)
);
IF OBJECT_ID(N'analytics.RiskPublication', N'U') IS NULL
CREATE TABLE analytics.RiskPublication (
    TenantId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_RiskPublication PRIMARY KEY,
    PublishedRunId UNIQUEIDENTIFIER NULL,
    PublishedAtUtc DATETIME2(3) NULL,
    PolicyVersion VARCHAR(40) COLLATE Latin1_General_100_BIN2 NULL,
    SourceSnapshotVersion BIGINT NULL,
    LoanCount INT NULL,
    CONSTRAINT FK_RiskPublication_Tenant FOREIGN KEY (TenantId) REFERENCES analytics.Tenants(TenantId),
    CONSTRAINT FK_RiskPublication_Run FOREIGN KEY (TenantId, PublishedRunId) REFERENCES analytics.RiskJob(TenantId, RunId),
    CONSTRAINT CK_RiskPublication_State CHECK (
        (PublishedRunId IS NULL AND PublishedAtUtc IS NULL AND PolicyVersion IS NULL AND SourceSnapshotVersion IS NULL AND LoanCount IS NULL)
        OR (PublishedRunId IS NOT NULL AND PublishedAtUtc IS NOT NULL AND PolicyVersion IS NOT NULL
            AND PolicyVersion = 'risk-demo-v1' AND SourceSnapshotVersion IS NOT NULL AND SourceSnapshotVersion >= 0 AND LoanCount IS NOT NULL AND LoanCount >= 0))
);
COMMIT;
GO
CREATE OR ALTER VIEW analytics.PublishedLoanPortfolio
AS
SELECT p.*, s.LoanRiskRating, r.PublishedRunId AS RiskRunId, r.PublishedAtUtc AS RiskCalculatedAtUtc
FROM analytics.LoanPortfolio AS p
LEFT JOIN analytics.RiskPublication AS r ON r.TenantId = p.TenantId
LEFT JOIN analytics.RiskScoreStage AS s
    ON s.TenantId = p.TenantId AND s.RunId = r.PublishedRunId AND s.LoanId = p.LoanId;
GO
CREATE OR ALTER PROCEDURE analytics.PublishRiskRun
    @TenantId UNIQUEIDENTIFIER,
    @RunId UNIQUEIDENTIFIER,
    @SourceSnapshotVersion BIGINT
WITH EXECUTE AS OWNER
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    -- An independent transaction is required: errors must not roll back a caller's other work.
    IF @@TRANCOUNT <> 0 THROW 51000, 'PUBLICATION_REQUIRES_OWN_TRANSACTION', 1;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @Tenant UNIQUEIDENTIFIER, @CurrentRun UNIQUEIDENTIFIER, @CurrentVersion BIGINT,
                @Status VARCHAR(15), @Total INT, @Processed INT, @Lease DATETIME2(3),
                @Created DATETIME2(3), @PreviousCreated DATETIME2(3), @Active BIGINT,
                @Staged BIGINT, @Watermark BIGINT;
        -- Serialize publications for this tenant even before its first publication exists.
        SELECT @Tenant = TenantId FROM analytics.Tenants WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @TenantId;
        IF @Tenant IS NULL THROW 51001, 'UNKNOWN_TENANT', 1;
        SELECT @CurrentRun = PublishedRunId, @CurrentVersion = SourceSnapshotVersion
        FROM analytics.RiskPublication WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @TenantId;
        SELECT @Status = Status, @Total = TotalLoans, @Processed = ProcessedLoans,
               @Lease = LeaseUntilUtc, @Created = CreatedAtUtc
        FROM analytics.RiskJob WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @TenantId AND RunId = @RunId;
        IF @CurrentRun = @RunId AND @Status = 'SUCCEEDED'
        BEGIN
            COMMIT;
            RETURN;
        END;
        IF @Status IS NULL OR @Status <> 'RUNNING' OR @Lease IS NULL OR @Lease <= SYSUTCDATETIME()
            THROW 51002, 'RUN_NOT_RUNNING_OR_LEASE_EXPIRED', 1;
        SELECT @PreviousCreated = CreatedAtUtc FROM analytics.RiskJob WITH (HOLDLOCK)
        WHERE TenantId = @TenantId AND RunId = @CurrentRun;
        IF @SourceSnapshotVersion IS NULL OR @SourceSnapshotVersion < 0
           OR @SourceSnapshotVersion < @CurrentVersion OR @Created <= @PreviousCreated
            THROW 51003, 'STALE_RUN', 1;
        SELECT @Active = COUNT_BIG(*), @Watermark = COALESCE(MAX(SourceVersion), 0)
        FROM analytics.LoanPortfolio WITH (HOLDLOCK) WHERE TenantId = @TenantId AND Status = 'ACTIVE';
        SELECT @Staged = COUNT_BIG(*) FROM analytics.RiskScoreStage WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @TenantId AND RunId = @RunId;
        IF @Total <> @Active OR @Processed <> @Total OR @Staged <> @Active OR @Watermark <> @SourceSnapshotVersion
            THROW 51004, 'INCOMPLETE_OR_CHANGED_SNAPSHOT', 1;
        IF EXISTS (
            SELECT 1 FROM analytics.RiskScoreStage AS s WITH (HOLDLOCK)
            JOIN analytics.LoanPortfolio AS p WITH (HOLDLOCK) ON p.TenantId = s.TenantId AND p.LoanId = s.LoanId
            WHERE s.TenantId = @TenantId AND s.RunId = @RunId
              AND (p.Status <> 'ACTIVE' OR s.InputSourceVersion <> p.SourceVersion OR s.PolicyVersion <> 'risk-demo-v1')
        ) THROW 51005, 'SCORE_INPUT_MISMATCH', 1;
        -- Stage PK + exact counts + active membership prove complete one-score-per-active-loan coverage.
        UPDATE analytics.RiskJob SET Status = 'SUCCEEDED', CompletedAtUtc = SYSUTCDATETIME(), LeaseUntilUtc = NULL, ErrorCode = NULL
        WHERE TenantId = @TenantId AND RunId = @RunId;
        UPDATE analytics.RiskPublication SET PublishedRunId = @RunId, PublishedAtUtc = SYSUTCDATETIME(),
            PolicyVersion = 'risk-demo-v1', SourceSnapshotVersion = @SourceSnapshotVersion, LoanCount = @Total
        WHERE TenantId = @TenantId;
        IF @@ROWCOUNT = 0
            INSERT analytics.RiskPublication (TenantId, PublishedRunId, PublishedAtUtc, PolicyVersion, SourceSnapshotVersion, LoanCount)
            VALUES (@TenantId, @RunId, SYSUTCDATETIME(), 'risk-demo-v1', @SourceSnapshotVersion, @Total);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE OR ALTER TRIGGER analytics.TR_RiskScoreStage_Immutable
ON analytics.RiskScoreStage AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1 FROM (
            SELECT TenantId, RunId FROM inserted UNION SELECT TenantId, RunId FROM deleted
        ) AS changed
        JOIN analytics.RiskJob AS j WITH (UPDLOCK, HOLDLOCK) ON j.TenantId = changed.TenantId AND j.RunId = changed.RunId
        LEFT JOIN analytics.RiskPublication AS r ON r.TenantId = changed.TenantId AND r.PublishedRunId = changed.RunId
        WHERE j.Status = 'SUCCEEDED' OR r.PublishedRunId IS NOT NULL
    ) THROW 51006, 'SUCCESSFUL_SCORES_ARE_IMMUTABLE', 1;
END;
GO
CREATE OR ALTER TRIGGER analytics.TR_RiskJob_Immutable
ON analytics.RiskJob AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM deleted WHERE Status = 'SUCCEEDED')
        THROW 51007, 'SUCCESSFUL_JOB_IS_IMMUTABLE', 1;
END;
GO
IF DATABASE_PRINCIPAL_ID(N'analytics_reader') IS NULL CREATE ROLE analytics_reader AUTHORIZATION dbo;
IF DATABASE_PRINCIPAL_ID(N'analytics_worker') IS NULL CREATE ROLE analytics_worker AUTHORIZATION dbo;
GRANT SELECT ON OBJECT::analytics.PublishedLoanPortfolio TO analytics_reader;
GRANT SELECT ON OBJECT::analytics.RiskJob TO analytics_reader;
GRANT SELECT ON OBJECT::analytics.RiskPublication TO analytics_reader;
GRANT SELECT ON OBJECT::analytics.LoanPortfolio TO analytics_worker;
GRANT SELECT ON OBJECT::analytics.PaymentHistory TO analytics_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::analytics.RiskJob TO analytics_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::analytics.RiskScoreStage TO analytics_worker;
GRANT SELECT ON OBJECT::analytics.RiskPublication TO analytics_worker;
DENY INSERT, UPDATE, DELETE ON OBJECT::analytics.RiskPublication TO analytics_worker;
GRANT EXECUTE ON OBJECT::analytics.PublishRiskRun TO analytics_worker;
GO
