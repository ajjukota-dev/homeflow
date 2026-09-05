/**
 * A column-driven table. Wide content scrolls inside its own container so the
 * page body never scrolls sideways at 320 px (CLAUDE.md responsive rule).
 */
import type { ReactNode } from "react";

export interface Column<Row> {
  key: string;
  header: string;
  /** Right-aligned, tabular numerals — money and counts. */
  numeric?: boolean;
  render: (row: Row) => ReactNode;
}

export interface TableProps<Row> {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
}

export function Table<Row>({ caption, columns, rows, rowKey }: TableProps<Row>) {
  return (
    <div className="hf-table-wrap">
      <table className="hf-table">
        <caption className="hf-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? "hf-num" : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "hf-num" : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
