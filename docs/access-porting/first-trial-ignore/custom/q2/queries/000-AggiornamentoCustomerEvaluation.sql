UPDATE Customer INNER JOIN CustomerEvaluationPerImport ON Customer.No_ = CustomerEvaluationPerImport.CustomerCode SET Customer.[Store Distribution] = [StoreDistribution], Customer.[Store Type] = [StoreType], Customer.[Store Image] = [StoreImage];

