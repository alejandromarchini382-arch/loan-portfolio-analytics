-- Tenant-leading indexes. Run after 001_schema.sql in the same database.
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
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.LoanPortfolio') AND name = N'IX_LoanPortfolio_Division')
    CREATE INDEX IX_LoanPortfolio_Division ON analytics.LoanPortfolio (TenantId, Status, Division) INCLUDE (CurrentBalance, InterestRate, LoanOfficer, BorrowerType);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.LoanPortfolio') AND name = N'IX_LoanPortfolio_Officer')
    CREATE INDEX IX_LoanPortfolio_Officer ON analytics.LoanPortfolio (TenantId, Status, LoanOfficer) INCLUDE (CurrentBalance, InterestRate, Division, BorrowerType);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.LoanPortfolio') AND name = N'IX_LoanPortfolio_BorrowerType')
    CREATE INDEX IX_LoanPortfolio_BorrowerType ON analytics.LoanPortfolio (TenantId, Status, BorrowerType) INCLUDE (CurrentBalance, InterestRate, Division, LoanOfficer);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.RiskScoreStage') AND name = N'IX_RiskScoreStage_Rating')
    CREATE INDEX IX_RiskScoreStage_Rating ON analytics.RiskScoreStage (TenantId, RunId, LoanRiskRating, LoanId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.Loans') AND name = N'IX_Loans_Borrower')
    CREATE INDEX IX_Loans_Borrower ON analytics.Loans (TenantId, BorrowerId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.Loans') AND name = N'IX_Loans_Division')
    CREATE INDEX IX_Loans_Division ON analytics.Loans (TenantId, DivisionId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.Loans') AND name = N'IX_Loans_Officer')
    CREATE INDEX IX_Loans_Officer ON analytics.Loans (TenantId, LoanOfficerId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.LoanPortfolio') AND name = N'IX_LoanPortfolio_Borrower')
    CREATE INDEX IX_LoanPortfolio_Borrower ON analytics.LoanPortfolio (TenantId, BorrowerId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.PaymentHistory') AND name = N'IX_PaymentHistory_LastSix')
    CREATE INDEX IX_PaymentHistory_LastSix ON analytics.PaymentHistory (TenantId, LoanId, PaymentDate DESC, PostedAtUtc DESC, PaymentId DESC) INCLUDE (IsLate, PaymentAmount);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.RiskJob') AND name = N'UX_RiskJob_Idempotency')
    CREATE UNIQUE INDEX UX_RiskJob_Idempotency ON analytics.RiskJob (TenantId, IdempotencyKey) WHERE IdempotencyKey IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.RiskJob') AND name = N'IX_RiskJob_Queue')
    CREATE INDEX IX_RiskJob_Queue ON analytics.RiskJob (TenantId, Status, CreatedAtUtc) INCLUDE (RunId, LeaseUntilUtc, Attempts);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.RiskScoreStage') AND name = N'IX_RiskScoreStage_Loan')
    CREATE INDEX IX_RiskScoreStage_Loan ON analytics.RiskScoreStage (TenantId, LoanId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'analytics.RiskPublication') AND name = N'IX_RiskPublication_Run')
    CREATE INDEX IX_RiskPublication_Run ON analytics.RiskPublication (TenantId, PublishedRunId);
COMMIT;
