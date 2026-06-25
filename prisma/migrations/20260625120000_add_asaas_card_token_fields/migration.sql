IF COL_LENGTH('Titular', 'asaasCardTokenEncrypted') IS NULL
BEGIN
  ALTER TABLE Titular ADD asaasCardTokenEncrypted NVARCHAR(1000) NULL;
END

IF COL_LENGTH('Titular', 'asaasCardLast4') IS NULL
BEGIN
  ALTER TABLE Titular ADD asaasCardLast4 NVARCHAR(10) NULL;
END

IF COL_LENGTH('Titular', 'asaasCardBrand') IS NULL
BEGIN
  ALTER TABLE Titular ADD asaasCardBrand NVARCHAR(50) NULL;
END

IF COL_LENGTH('Titular', 'asaasCardHolderName') IS NULL
BEGIN
  ALTER TABLE Titular ADD asaasCardHolderName NVARCHAR(255) NULL;
END

IF COL_LENGTH('Titular', 'asaasCardTokenizedAt') IS NULL
BEGIN
  ALTER TABLE Titular ADD asaasCardTokenizedAt DATETIME2 NULL;
END
