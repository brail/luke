SELECT SoggettiProvvigionaliSistemazione2018.*, [ProspettoProvvigioniStagioneMarchio-Sistemazione2018].*
FROM SoggettiProvvigionaliSistemazione2018 INNER JOIN [ProspettoProvvigioniStagioneMarchio-Sistemazione2018] ON (SoggettiProvvigionaliSistemazione2018.[Area Manager Code] = [ProspettoProvvigioniStagioneMarchio-Sistemazione2018].[Salesperson Code]) AND (SoggettiProvvigionaliSistemazione2018.No_ = [ProspettoProvvigioniStagioneMarchio-Sistemazione2018].[Document No_]);

