SELECT First(VendutoCompratoProiezioneTabella.No_) AS No_Campo, First(VendutoCompratoProiezioneTabella.ColorCode) AS ColorCodeCampo, Count(VendutoCompratoProiezioneTabella.No_) AS NumDuplicati
FROM VendutoCompratoProiezioneTabella
GROUP BY VendutoCompratoProiezioneTabella.No_, VendutoCompratoProiezioneTabella.ColorCode
HAVING (((Count(VendutoCompratoProiezioneTabella.No_))>1) AND ((Count(VendutoCompratoProiezioneTabella.ColorCode))>1));

