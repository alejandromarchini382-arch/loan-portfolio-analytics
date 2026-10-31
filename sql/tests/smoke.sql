-- Disposable DB only. Called by test_database.py after both migrations and seed reruns.
SET NOCOUNT ON;
SET XACT_ABORT OFF;
IF DB_NAME() NOT LIKE 'loan[_]sql[_]test[_]%' THROW 52000, 'SMOKE_REQUIRES_DISPOSABLE_TEST_DATABASE', 1;
DECLARE @A UNIQUEIDENTIFIER = NEWID(), @B UNIQUEIDENTIFIER = NEWID(),
    @L1 UNIQUEIDENTIFIER = NEWID(), @L2 UNIQUEIDENTIFIER = NEWID(),
    @Borrower UNIQUEIDENTIFIER = NEWID(), @OnlyB UNIQUEIDENTIFIER = NEWID(),
    @Division UNIQUEIDENTIFIER = NEWID(), @Officer UNIQUEIDENTIFIER = NEWID(),
    @Run1 UNIQUEIDENTIFIER = NEWID(), @Run2 UNIQUEIDENTIFIER = NEWID(), @Run3 UNIQUEIDENTIFIER = NEWID(),
    @Rejected BIT, @Sql NVARCHAR(MAX), @Checks INT = 0;
INSERT analytics.Tenants VALUES (@A, N'Smoke A'), (@B, N'Smoke B');
INSERT analytics.Borrowers VALUES
    (@A, @Borrower, N'Fictional A', 'INDIVIDUAL', NULL, NULL),
    (@B, @Borrower, N'Fictional B', 'CORPORATE', N'Demo', 'HIGH'),
    (@B, @OnlyB, N'Only B', 'INDIVIDUAL', NULL, NULL);
INSERT analytics.Divisions VALUES (@B, @Division, N'Commercial');
INSERT analytics.LoanOfficers VALUES (@B, @Officer, N'Demo Officer');
INSERT analytics.Loans (TenantId, LoanId, LoanNumber, BorrowerId, PrincipalAmount, CurrentBalance,
    InterestRate, Status, OriginationDate, MaturityDate, DaysPastDue, CurrencyCode, SourceVersion, UpdatedAtUtc)
VALUES (@A, @L1, 'OVERLAP-1', @Borrower, 1000, 100, .05, 'ACTIVE', '20240101', '20290101', 0, 'USD', 1, SYSUTCDATETIME()),
       (@A, @L2, 'OVERLAP-2', @Borrower, 1000, 300, NULL, 'ACTIVE', '20240101', '20290101', 0, 'USD', 1, SYSUTCDATETIME()),
       (@B, @L1, 'OVERLAP-1', @Borrower, 1000, 900, .12, 'ACTIVE', '20240101', '20290101', 65, 'USD', 1, SYSUTCDATETIME());
INSERT analytics.LoanPortfolio (TenantId, LoanId, LoanNumber, BorrowerId, BorrowerName, BorrowerType,
    PrincipalAmount, CurrentBalance, InterestRate, Status, Division, LoanOfficer, OriginationDate, MaturityDate,
    DaysPastDue, CurrencyCode, SourceVersion, LastSyncedUtc)
SELECT l.TenantId, l.LoanId, l.LoanNumber, l.BorrowerId, b.BorrowerName, b.BorrowerType,
    l.PrincipalAmount, l.CurrentBalance, l.InterestRate, l.Status,
    CASE WHEN l.LoanId = @L2 THEN NULL ELSE N'Commercial' END, N'Demo Officer', l.OriginationDate,
    l.MaturityDate, l.DaysPastDue, l.CurrencyCode, l.SourceVersion, l.UpdatedAtUtc
FROM analytics.Loans l JOIN analytics.Borrowers b ON b.TenantId = l.TenantId AND b.BorrowerId = l.BorrowerId
WHERE l.TenantId IN (@A, @B);
IF (SELECT COUNT(*) FROM analytics.PublishedLoanPortfolio WHERE TenantId = @A AND LoanRiskRating IS NULL) <> 2
    THROW 52001, 'UNRATED_FAILED', 1;
IF (SELECT SUM(CurrentBalance) FROM analytics.PublishedLoanPortfolio WHERE TenantId = @A) <> 400
   OR (SELECT AVG(CAST(InterestRate AS DECIMAL(18,8))) FROM analytics.PublishedLoanPortfolio WHERE TenantId = @A) <> .05
   OR (SELECT COUNT(*) FROM analytics.PublishedLoanPortfolio WHERE TenantId = @A AND Division IS NULL) <> 1
    THROW 52002, 'TENANT_AGGREGATE_FAILED', 1;
IF (SELECT COUNT(*) FROM (SELECT Division, LoanOfficer, COUNT(*) n FROM analytics.PublishedLoanPortfolio
    WHERE TenantId = @A GROUP BY Division, LoanOfficer) g) <> 2
    THROW 52003, 'SECOND_GROUPING_FAILED', 1;
SET @Checks += 3;
SET @Rejected = 0;
BEGIN TRY UPDATE analytics.Loans SET BorrowerId = @OnlyB WHERE TenantId = @A AND LoanId = @L1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 547 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52004, 'CROSS_TENANT_BORROWER_ACCEPTED', 1;
SET @Rejected = 0;
BEGIN TRY UPDATE analytics.Loans SET DivisionId = @Division WHERE TenantId = @A AND LoanId = @L1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 547 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52005, 'CROSS_TENANT_DIVISION_ACCEPTED', 1;
SET @Rejected = 0;
BEGIN TRY UPDATE analytics.Loans SET LoanOfficerId = @Officer WHERE TenantId = @A AND LoanId = @L1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 547 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52006, 'CROSS_TENANT_OFFICER_ACCEPTED', 1;
SET @Rejected = 0;
BEGIN TRY UPDATE analytics.Loans SET Status = 'INVALID' WHERE TenantId = @A AND LoanId = @L1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 547 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52007, 'INVALID_STATUS_ACCEPTED', 1;
SET @Checks += 4;
SET @Rejected = 0;
BEGIN TRY UPDATE analytics.Loans SET LoanNumber = 'OVERLAP-1' WHERE TenantId = @A AND LoanId = @L2;
END TRY BEGIN CATCH IF ERROR_NUMBER() NOT IN (2601, 2627) THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52020, 'DUPLICATE_TENANT_LOAN_NUMBER_ACCEPTED', 1;
SET @Rejected = 0;
BEGIN TRY UPDATE analytics.Borrowers SET BorrowerRiskRating = 'INVALID' WHERE TenantId = @A AND BorrowerId = @Borrower;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 547 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52021, 'INVALID_BORROWER_RISK_ACCEPTED', 1;
SET @Rejected = 0;
BEGIN TRY INSERT analytics.PaymentHistory VALUES (@B, NEWID(), @L2, '20260101', 100, 0, '20260101');
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 547 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52022, 'CROSS_TENANT_PAYMENT_ACCEPTED', 1;
SET @Rejected = 0;
BEGIN TRY UPDATE analytics.LoanPortfolio SET BorrowerId = @OnlyB WHERE TenantId = @A AND LoanId = @L1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 547 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52023, 'CROSS_TENANT_PROJECTION_ACCEPTED', 1;
SET @Checks += 4;
INSERT analytics.RiskJob (TenantId, JobId, JobType, Status, RunId, CreatedAtUtc, StartedAtUtc,
    LeaseUntilUtc, ProcessedLoans, TotalLoans)
VALUES (@A, NEWID(), 'RECALCULATE_LOAN_RISK', 'RUNNING', @Run1, '20260101', SYSUTCDATETIME(), DATEADD(MINUTE, 30, SYSUTCDATETIME()), 2, 2),
       (@A, NEWID(), 'RECALCULATE_LOAN_RISK', 'RUNNING', @Run2, '20260102', SYSUTCDATETIME(), DATEADD(MINUTE, 30, SYSUTCDATETIME()), 2, 2),
       (@A, NEWID(), 'RECALCULATE_LOAN_RISK', 'FAILED', @Run3, '20260103', SYSUTCDATETIME(), NULL, 0, 2);
SET @Rejected = 0;
BEGIN TRY INSERT analytics.RiskScoreStage VALUES (@B, @Run1, @L1, 'LOW', 'risk-demo-v1', 1, 0, .1, 0, 0, SYSUTCDATETIME());
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 547 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52008, 'CROSS_TENANT_RUN_ACCEPTED', 1;
INSERT analytics.RiskScoreStage
SELECT @A, @Run1, LoanId, 'LOW', 'risk-demo-v1', SourceVersion, DaysPastDue,
    CurrentBalance / PrincipalAmount, 0, 0, SYSUTCDATETIME()
FROM analytics.LoanPortfolio WHERE TenantId = @A;
IF EXISTS (SELECT 1 FROM analytics.PublishedLoanPortfolio WHERE TenantId = @A AND LoanRiskRating IS NOT NULL)
    THROW 52009, 'STAGED_SCORES_LEAKED', 1;
CREATE USER sql_smoke_worker WITHOUT LOGIN;
ALTER ROLE analytics_worker ADD MEMBER sql_smoke_worker;
EXECUTE AS USER = 'sql_smoke_worker';
EXEC analytics.PublishRiskRun @A, @Run1, 1;
REVERT;
EXEC analytics.PublishRiskRun @A, @Run1, 1;
IF (SELECT COUNT(*) FROM analytics.PublishedLoanPortfolio WHERE TenantId = @A AND LoanRiskRating = 'LOW') <> 2
   OR (SELECT Status FROM analytics.RiskJob WHERE TenantId = @A AND RunId = @Run1) <> 'SUCCEEDED'
    THROW 52010, 'PUBLICATION_FAILED', 1;
IF EXISTS (SELECT 1 FROM analytics.PublishedLoanPortfolio WHERE TenantId = @B AND LoanRiskRating IS NOT NULL)
    THROW 52011, 'CROSS_TENANT_RATING_LEAKED', 1;
SET @Checks += 4;
INSERT analytics.RiskScoreStage VALUES (@A, @Run2, @L1, 'HIGH', 'risk-demo-v1', 1, 0, .1, 0, 0, SYSUTCDATETIME());
SET @Rejected = 0;
BEGIN TRY EXEC analytics.PublishRiskRun @A, @Run2, 1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 51004 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52012, 'PARTIAL_PUBLICATION_ACCEPTED', 1;
SET @Rejected = 0;
BEGIN TRY EXEC analytics.PublishRiskRun @A, @Run3, 1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 51002 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52013, 'FAILED_PUBLICATION_ACCEPTED', 1;
IF (SELECT PublishedRunId FROM analytics.RiskPublication WHERE TenantId = @A) <> @Run1
    THROW 52014, 'OLD_PUBLICATION_LOST', 1;
SET @Checks += 3;
INSERT analytics.RiskScoreStage VALUES (@A, @Run2, @L2, 'LOW', 'risk-demo-v1', 2, 0, .3, 0, 0, SYSUTCDATETIME());
SET @Rejected = 0;
BEGIN TRY EXEC analytics.PublishRiskRun @A, @Run2, 1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 51005 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52017, 'CHANGED_INPUT_ACCEPTED', 1;
UPDATE analytics.RiskScoreStage SET InputSourceVersion = 1 WHERE TenantId = @A AND RunId = @Run2;
UPDATE analytics.RiskJob SET LeaseUntilUtc = '20200101' WHERE TenantId = @A AND RunId = @Run2;
SET @Rejected = 0;
BEGIN TRY EXEC analytics.PublishRiskRun @A, @Run2, 1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 51002 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52018, 'EXPIRED_LEASE_ACCEPTED', 1;
IF (SELECT PublishedRunId FROM analytics.RiskPublication WHERE TenantId = @A) <> @Run1
    THROW 52019, 'PUBLICATION_CHANGED_AFTER_FAILURE', 1;
SET @Checks += 3;
UPDATE analytics.RiskScoreStage SET LoanRiskRating = 'LOW' WHERE TenantId = @A AND RunId = @Run2;
UPDATE analytics.RiskJob SET LeaseUntilUtc = DATEADD(MINUTE, 30, SYSUTCDATETIME()) WHERE TenantId = @A AND RunId = @Run2;
EXEC analytics.PublishRiskRun @A, @Run2, 1;
IF (SELECT PublishedRunId FROM analytics.RiskPublication WHERE TenantId = @A) <> @Run2
    THROW 52024, 'COMPLETE_REPLACEMENT_FAILED', 1;
SET @Rejected = 0;
BEGIN TRY EXEC analytics.PublishRiskRun @A, @Run1, 1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 51002 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52025, 'OLD_SUCCESSFUL_RUN_REPUBLISHED', 1;
SET @Checks += 2;
SET @Rejected = 0;
BEGIN TRY UPDATE analytics.RiskScoreStage SET LoanRiskRating = 'HIGH' WHERE TenantId = @A AND RunId = @Run1;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 51006 THROW; SET @Rejected = 1; END CATCH;
IF @Rejected = 0 THROW 52015, 'PUBLISHED_SCORES_MUTABLE', 1;
SET @Rejected = 0;
EXECUTE AS USER = 'sql_smoke_worker';
BEGIN TRY UPDATE analytics.RiskPublication SET PublishedRunId = NULL WHERE TenantId = @A;
END TRY BEGIN CATCH IF ERROR_NUMBER() <> 229 BEGIN REVERT; THROW; END; SET @Rejected = 1; END CATCH;
REVERT;
IF @Rejected = 0 THROW 52016, 'WORKER_POINTER_WRITE_ALLOWED', 1;
SET @Checks += 2;
PRINT CONCAT('SQL smoke passed: ', @Checks, ' checks.');
