/** Server-paginated, accessible data table with optional CSV export. */
import { type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button, Spinner, EmptyState, ErrorState } from './ui';
import { errorMessage } from '../lib/api';
import { downloadCsv } from '../lib/csv';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  /** String accessor for CSV export. Defaults to String(row[key]). */
  csv?: (row: T) => string;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  items: T[];
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  page?: number;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  exportName?: string; // enables CSV export of the current page when set
  emptyMessage?: string;
}

export function DataTable<T>({
  columns, items, isLoading, isFetching, error, rowKey, onRowClick,
  page, canPrev, canNext, onPrev, onNext, exportName, emptyMessage,
}: DataTableProps<T>) {
  const exportCsv = () => {
    const headers = columns.map((c) => c.header);
    const rows = items.map((row) =>
      columns.map((c) => (c.csv ? c.csv(row) : String((row as Record<string, unknown>)[c.key] ?? ''))),
    );
    downloadCsv(`${exportName}-page${page ?? 1}`, headers, rows);
  };

  return (
    <div className="card overflow-hidden">
      {exportName && (
        <div className="flex items-center justify-end border-b border-slate-100 px-3 py-2">
          <Button variant="ghost" onClick={exportCsv} disabled={!items.length} title="Export current page (masked data only)">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="table-th whitespace-nowrap">{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer hover:bg-slate-50' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`table-td ${c.className ?? ''}`}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
      {!isLoading && error != null && <div className="p-4"><ErrorState message={errorMessage(error)} /></div>}
      {!isLoading && !error && items.length === 0 && <EmptyState message={emptyMessage} />}

      {(canPrev || canNext) && (
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-sm text-slate-500">
          <span>Page {page ?? 1}{isFetching ? ' · loading…' : ''}</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onPrev} disabled={!canPrev}><ChevronLeft className="h-4 w-4" /> Prev</Button>
            <Button variant="secondary" onClick={onNext} disabled={!canNext}>Next <ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
