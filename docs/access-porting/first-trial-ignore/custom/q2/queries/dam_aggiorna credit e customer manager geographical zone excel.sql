UPDATE [RESP COMM CRED] INNER JOIN [Geographical Zone] ON [RESP COMM CRED].GeographicalZoneDescription = [Geographical Zone].Description SET [Geographical Zone].[Credit Manager] = [RESP COMM CRED.Credit Manager], [Geographical Zone].[Commercial Manager] = [RESP COMM CRED.Commercial manager];

