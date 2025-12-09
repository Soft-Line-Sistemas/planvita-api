BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[NotificationSchedule] DROP CONSTRAINT [NotificationSchedule_metodoPreferencial_df],
[NotificationSchedule_updatedAt_df];
ALTER TABLE [dbo].[NotificationSchedule] ADD CONSTRAINT [NotificationSchedule_metodoPreferencial_df] DEFAULT 'whatsapp' FOR [metodoPreferencial];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
