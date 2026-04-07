SELECT CustomerEvaluationPerImport.CustomerCode, CustomerEvaluationPerImport.CustomerName, Customer.[Store Distribution], CustomerEvaluationPerImport.StoreDistribution, Customer.[Store Type], CustomerEvaluationPerImport.StoreType, Customer.[Store Image], CustomerEvaluationPerImport.StoreImage
FROM Customer INNER JOIN CustomerEvaluationPerImport ON Customer.No_ = CustomerEvaluationPerImport.CustomerCode
WHERE (((Customer.[Store Distribution])<>[StoreDistribution])) OR (((Customer.[Store Type])<>[StoreType])) OR (((Customer.[Store Image])<>[StoreImage]));

