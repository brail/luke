/**
 * Componente di paginazione per la tabella delle configurazioni
 * Mostra informazioni sulla pagina corrente e controlli di navigazione
 */

import { Button } from '../ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ConfigTablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function ConfigTablePagination({
  page,
  pageSize,
  total,
  onPageChange,
}: ConfigTablePaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  const handlePrevious = () => {
    if (page > 1) {
      onPageChange(page - 1);
    }
  };

  const handleNext = () => {
    if (page < totalPages) {
      onPageChange(page + 1);
    }
  };

  if (total === 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between px-2 py-4">
      <div className="text-sm text-muted-foreground">
        Pagina {page} di {totalPages} — Totale: {total} configurazioni
      </div>

      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrevious}
          disabled={page <= 1}
          className="flex items-center gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          Precedente
        </Button>

        <div className="flex items-center space-x-1">
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (page <= 3) {
              pageNum = i + 1;
            } else if (page >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = page - 2 + i;
            }

            return (
              <Button
                key={pageNum}
                variant={pageNum === page ? 'default' : 'outline'}
                size="sm"
                onClick={() => onPageChange(pageNum)}
                className="w-8 h-8 p-0"
              >
                {pageNum}
              </Button>
            );
          })}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleNext}
          disabled={page >= totalPages}
          className="flex items-center gap-1"
        >
          Successiva
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
