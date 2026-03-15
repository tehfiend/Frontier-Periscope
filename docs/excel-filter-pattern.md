# Task: Add Excel-Like Column Filters to All Data Grids

## Overview

This project uses TanStack React Table v8 (`@tanstack/react-table` v8.21.3) with `@tanstack/react-virtual` v3.13.18 for virtualization. There is an existing Excel-style column filter component at `src/components/column-filter.tsx` that is fully functional but only integrated into the model viewer grids. Your job is to add it to every other data grid in the application.

**Do NOT rewrite or modify `src/components/column-filter.tsx`.** It works. Just import and use it.

---

## The Existing ColumnFilter Component

**File: `src/components/column-filter.tsx`** - Already exists, do not modify. Here is the full source for reference:

```tsx
"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Column, FilterFn } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowUp,
  ArrowDown,
  ListFilter,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// --- Types ---

export interface ExcelFilterValue {
  mode: "include" | "textFilter";
  /** "include" mode: set of values to show (undefined = all / no filter) */
  includedValues?: Set<string>;
  /** "textFilter" mode fields */
  textFilterType?:
    | "equals"
    | "notEquals"
    | "beginsWith"
    | "endsWith"
    | "contains"
    | "notContains";
  textFilterValue?: string;
}

interface ColumnFilterProps<TData> {
  column: Column<TData, unknown>;
  /** Display labels for raw values (e.g. { "true": "Assigned" }) */
  valueLabels?: Record<string, string>;
}

// --- Shared filter function ---

export const excelFilterFn: FilterFn<any> = (row, columnId, filterValue) => {
  const filter = filterValue as ExcelFilterValue | undefined;
  if (!filter) return true;

  const rawVal = String(row.getValue(columnId));

  if (filter.mode === "include" && filter.includedValues) {
    return filter.includedValues.has(rawVal);
  }

  if (filter.mode === "textFilter" && filter.textFilterValue) {
    const cellVal = rawVal.toLowerCase();
    const filterVal = filter.textFilterValue.toLowerCase();
    switch (filter.textFilterType) {
      case "equals":
        return cellVal === filterVal;
      case "notEquals":
        return cellVal !== filterVal;
      case "beginsWith":
        return cellVal.startsWith(filterVal);
      case "endsWith":
        return cellVal.endsWith(filterVal);
      case "notContains":
        return !cellVal.includes(filterVal);
      case "contains":
      default:
        return cellVal.includes(filterVal);
    }
  }

  return true;
};
```

The component renders a Popover with:
- Sort A-Z / Z-A buttons
- Collapsible "Text Filters" section (operator dropdown + value input, 6 operators)
- Virtualized checkbox list of unique values (populated from TanStack's faceted row model)
- Search box to filter the checkbox list
- Select All with indeterminate state
- OK/Cancel buttons (pending state - changes only applied on OK)

**Exports used:** `ColumnFilter` (the component), `excelFilterFn` (the filter function), `ExcelFilterValue` (the type).

---

## The Existing TableToolbar Component

**File: `src/components/table-toolbar.tsx`** - Some tables use this. It has a `leftSlot` prop where you can place the "Clear Filters" button.

```tsx
interface TableToolbarProps {
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  searchPlaceholder?: string;
  onExportCsv?: () => void;
  onExportExcel?: () => void;
  onPrint?: () => void;
  leftSlot?: React.ReactNode;   // <-- put Clear Filters button here
  children?: React.ReactNode;
}
```

---

## Integration Pattern (what "done" looks like)

Here is the complete pattern from the model viewer's UnifiedGrid, which already works. Follow this exact pattern for every table.

### Step 1: Add imports

```tsx
import {
  type ColumnFiltersState,
  getFilteredRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
} from "@tanstack/react-table";
import { ColumnFilter, excelFilterFn } from "@/components/column-filter";
import { X } from "lucide-react";  // for the Clear Filters button
```

Note: Many tables already import some of these (e.g., `getFilteredRowModel` for global filter). Only add what's missing.

### Step 2: Add column filter state

```tsx
const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
```

### Step 3: Add `filterFn` to filterable column definitions

For each column that should be filterable, add `filterFn: excelFilterFn`. For columns that should NOT be filterable, add `enableColumnFilter: false`.

```tsx
// BEFORE (no filter):
{
  id: "jobId",
  accessorKey: "jobId",
  header: sortHeader("Job #"),
  size: 70,
},

// AFTER (with filter):
{
  id: "jobId",
  accessorKey: "jobId",
  header: sortHeader("Job #"),
  size: 70,
  filterFn: excelFilterFn,
},
```

For columns that should NOT be filterable (numeric/currency, action columns, computed aggregates):
```tsx
{
  id: "contractAmount",
  accessorKey: "contractAmount",
  header: sortHeader("Contract"),
  size: 110,
  enableColumnFilter: false,  // currency column, not useful to filter
},
```

### Step 4: Wire up the table instance

Add filter state and faceted models to the `useReactTable` call:

```tsx
// BEFORE:
const table = useReactTable({
  data: displayRows,
  columns,
  state: { sorting },
  onSortingChange: setSorting,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
});

// AFTER:
const table = useReactTable({
  data: displayRows,
  columns,
  state: { sorting, columnFilters },
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getFacetedRowModel: getFacetedRowModel(),
  getFacetedUniqueValues: getFacetedUniqueValues(),
});
```

If the table already has `getFilteredRowModel()` (for global filter), don't duplicate it -- just add the faceted ones.

### Step 5: Add ColumnFilter to header rendering

Find the header rendering loop and add the ColumnFilter icon next to each header. The exact change depends on how the table renders headers.

**Pattern A: Simple `flexRender` headers** (most tables):

```tsx
// BEFORE:
<th key={header.id} className="...">
  {header.isPlaceholder
    ? null
    : flexRender(header.column.columnDef.header, header.getContext())}
</th>

// AFTER:
<th key={header.id} className="...">
  {header.isPlaceholder ? null : (
    <div className="flex items-center gap-1">
      {flexRender(header.column.columnDef.header, header.getContext())}
      {header.column.getCanFilter() && (
        <ColumnFilter column={header.column} />
      )}
    </div>
  )}
</th>
```

**Pattern B: Tables using shadcn `<TableHead>`** (same idea, different element):

```tsx
<TableHead key={header.id}>
  {header.isPlaceholder ? null : (
    <div className="flex items-center gap-1">
      {flexRender(header.column.columnDef.header, header.getContext())}
      {header.column.getCanFilter() && (
        <ColumnFilter column={header.column} />
      )}
    </div>
  )}
</TableHead>
```

**Pattern C: Tables with column groups** (e.g., BillingStatusTable) - Only leaf columns (not group headers) should get filter icons. Group headers (`header.isPlaceholder === true` or `header.column.columns.length > 0`) should be skipped.

### Step 6: Add "Clear Filters" indicator

Show a bar/button when any column filter is active:

```tsx
const hasFilters = columnFilters.length > 0;
```

If the table uses `TableToolbar`, pass it in the `leftSlot`:
```tsx
<TableToolbar
  globalFilter={globalFilter}
  onGlobalFilterChange={setGlobalFilter}
  leftSlot={
    hasFilters ? (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
        onClick={() => setColumnFilters([])}
      >
        <X className="size-3" />
        Clear Filters
      </Button>
    ) : undefined
  }
/>
```

If the table has a custom toolbar or no toolbar, add a small bar above the table:
```tsx
{hasFilters && (
  <div className="flex items-center justify-end px-2 py-1 border-b bg-muted/20">
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
      onClick={() => setColumnFilters([])}
    >
      <X className="size-3" />
      Clear Filters
    </Button>
  </div>
)}
```

---

## Example: WIP Table Before/After

This shows how a typical table transformation looks.

### Before (current state):

```tsx
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

// ... column definitions with no filterFn ...

const table = useReactTable({
  data: displayRows,
  columns,
  state: { sorting },
  onSortingChange: setSorting,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
});

// ... header rendering:
<th key={header.id} className="...">
  {header.isPlaceholder
    ? null
    : flexRender(header.column.columnDef.header, header.getContext())}
</th>
```

### After:

```tsx
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { ColumnFilter, excelFilterFn } from "@/components/column-filter";
import { X } from "lucide-react";  // add to existing lucide import

// ... column definitions now have filterFn: excelFilterFn on filterable cols ...

const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

const table = useReactTable({
  data: displayRows,
  columns,
  state: { sorting, columnFilters },
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getFacetedRowModel: getFacetedRowModel(),
  getFacetedUniqueValues: getFacetedUniqueValues(),
});

const hasFilters = columnFilters.length > 0;

// ... in JSX, above the table:
{hasFilters && (
  <div className="flex items-center justify-end px-2 py-1 border-b bg-muted/20">
    <Button variant="ghost" size="sm"
      className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
      onClick={() => setColumnFilters([])}
    >
      <X className="size-3" /> Clear Filters
    </Button>
  </div>
)}

// ... header rendering:
<th key={header.id} className="...">
  {header.isPlaceholder ? null : (
    <div className="flex items-center gap-1">
      {flexRender(header.column.columnDef.header, header.getContext())}
      {header.column.getCanFilter() && (
        <ColumnFilter column={header.column} />
      )}
    </div>
  )}
</th>
```

---

## Which Columns Should Be Filterable

Rules of thumb:

| Column Type | Filterable? | Why |
|---|---|---|
| Text identifiers (job #, name, mark) | YES | Users filter by specific values |
| Enum/status (status, type, category) | YES | Classic checkbox filter use case |
| Boolean (include, active) | YES, with `valueLabels` | Map `"true"/"false"` to `"Yes"/"No"` |
| Currency/numeric (cost, weight, qty) | NO | Checkbox list of numbers is useless |
| Percentage (% complete) | NO | Same reason |
| Date/timestamp | NO | Too many unique values |
| Action columns (edit, delete buttons) | NO | Not data |
| Computed aggregates | NO | Derived, not source data |
| Override/editable cells | NO | These are inputs, not filters |

For boolean columns, pass `valueLabels`:
```tsx
<ColumnFilter column={header.column} valueLabels={{ "true": "Yes", "false": "No" }} />
```

---

## Tables to Update (Complete List)

### Already done (DO NOT TOUCH):
- `src/components/model/unified-grid.tsx`
- `src/components/model/model-viewer.tsx` (subMaterialTable, gridLineTable)
- `src/components/model/variance-section.tsx`
- `src/components/model/grid-lines-grid.tsx`
- `src/components/model/submaterials-grid.tsx`
- `src/components/model/model-grid-columns.tsx`

### Need column filters added:

**Reports (high priority - data-heavy, most benefit):**
- `src/components/reports/wip-table.tsx` - WIP report (~50 cols). Has custom `sortHeader()` factory. Filterable: jobId, description, pm. NOT filterable: all currency/numeric columns, override cells.
- `src/components/reports/billing-status-table.tsx` - Billing status (~50 cols, column groups). Filterable: jobId, description, status-like cols. NOT filterable: currency, editable cells. Watch for column groups - only leaf columns get filters.
- `src/components/reports/rfc-log-table.tsx` - RFC log (~15 cols). Has custom `SortHeader`. Filterable: projectId, description, status.
- `src/components/reports/billing-log-table.tsx` - Billing log.
- `src/components/reports/wip-snapshot-table.tsx` - WIP snapshot comparison.

**Production:**
- `src/app/(app)/production/production-landing.tsx` - Project list
- `src/app/(app)/production/[projectNumber]/pieces/production-grid-client.tsx` - Piece tracking
- `src/app/(app)/production/[projectNumber]/ncrs/ncr-list-client.tsx` - NCR list
- `src/app/(app)/production/[projectNumber]/variance/variance-client.tsx` - Variance
- `src/app/(app)/production/[projectNumber]/time-log/time-log-client.tsx` - Time log
- `src/app/(app)/production/[projectNumber]/loads/loads-table.tsx` - Loads
- `src/app/(app)/production/[projectNumber]/load/[loadNumber]/load-builder-client.tsx` - Load builder (has 2 tables: pieceTable, unassignedTable)
- `src/app/(app)/production/[projectNumber]/submaterials/submaterials-client.tsx` - Submaterials

**Core Modules:**
- `src/app/(app)/models/models-table.tsx` - Model list
- `src/app/(app)/models/snapshots/snapshots-browser.tsx` - Snapshot browser
- `src/app/(app)/models/snapshots/snapshots-grid.tsx` - Snapshot grid
- `src/app/(app)/models/snapshots/snapshot-create-dialog.tsx` - Snapshot create dialog
- `src/app/(app)/models/model-import-dialog.tsx` - Model import dialog
- `src/app/(app)/coordinator/coordinator-landing.tsx` - Coordinator
- `src/app/(app)/estimator/estimates-grid.tsx` - Estimates
- `src/app/(app)/sales/pursuits-table.tsx` - Sales pursuits
- `src/app/(app)/projects/project-table.tsx` - Projects
- `src/app/(app)/aisc-shapes/shapes-table.tsx` - AISC shapes

**Admin/Settings:**
- `src/app/(app)/users/user-table.tsx` - Users
- `src/app/(app)/users/[userId]/user-detail-client.tsx` - User audit log (auditTable)
- `src/app/(app)/contacts/contacts-table.tsx` - Contacts
- `src/app/(app)/companies/company-table.tsx` - Companies
- `src/app/(app)/permissions/roles/role-manager.tsx` - Role permissions
- `src/app/(app)/log/audit-log-table.tsx` - Audit log
- `src/app/(app)/development/mcr/mcr-list-client.tsx` - MCR list

**Materials:**
- `src/app/(app)/materials/nesting/nesting-table.tsx` - Nesting table
- `src/app/(app)/materials/nesting/[nestingId]/import-demand-grid.tsx` - Import demand
- `src/app/(app)/materials/nesting/[nestingId]/run-solver-dialog.tsx` - Solver dialog
- `src/app/(app)/materials/nesting/plate/plate-nesting-list-client.tsx` - Plate nesting
- `src/app/(app)/materials/inventory/inventory-items-table.tsx` - Inventory items
- `src/app/(app)/materials/inventory/flatbar-sizes-table.tsx` - Flatbar sizes
- `src/app/(app)/materials/inventory/drop-log-table.tsx` - Drop log
- `src/app/(app)/materials/inventory/shape-params-table.tsx` - Shape params
- `src/app/(app)/materials/inventory/grade-groups-table.tsx` - Grade groups
- `src/app/(app)/materials/inventory/material-sources-table.tsx` - Material sources
- `src/app/(app)/materials/procurement/mill-rules-table.tsx` - Mill rules
- `src/app/(app)/materials/procurement/stock-inquiries-tab.tsx` - Stock inquiries
- `src/app/(app)/materials/procurement/purchase-orders-tab.tsx` - Purchase orders
- `src/app/(app)/materials/procurement/[poId]/po-detail-client.tsx` - PO detail

**Library:**
- `src/components/library/file-list.tsx` - File list

---

## Important Notes

1. **Read each table before modifying it.** Every table has slightly different header rendering, column definition style, and toolbar layout. Understand the existing structure before making changes.

2. **Tables with custom `SortHeader` components** - Several tables (WIP, Billing, RFC) define a local `sortHeader()` factory or `SortHeader` component that renders clickable sort headers. The `ColumnFilter` goes NEXT TO the sort header in the `<th>`, not inside the sort header component. The ColumnFilter's own popover already has sort buttons, so they coexist fine.

3. **Tables with column groups** (BillingStatusTable) - Only leaf columns get filters, not group headers. Check `header.isPlaceholder` and `header.column.columns?.length`.

4. **Tables already using `getFilteredRowModel`** for global filter - These already have `getFilteredRowModel()`. Just add `getFacetedRowModel()` and `getFacetedUniqueValues()` and wire up the column filter state.

5. **Tables using native `<table>/<th>` vs shadcn `<Table>/<TableHead>`** - Both patterns exist. Follow whichever the table already uses.

6. **`valueLabels` prop** - Use for columns where raw values aren't user-friendly:
   - Boolean: `{ "true": "Yes", "false": "No" }`
   - Status enums: `{ "in_progress": "In Progress", "completed": "Completed" }`
   - The ColumnFilter accepts this as a prop: `<ColumnFilter column={header.column} valueLabels={...} />`

7. **Some tables compute `displayRows` by filtering before passing to TanStack** (e.g., WIP's "Show All/Included Only" toggle). Column filters work on top of whatever data is passed to the table, so this is fine.

8. **Don't add filters to dialog tables** that only show a handful of rows (like confirmation dialogs). Use judgment - if the table typically has < 10 rows, filters add clutter without value. The tables in the list above are all substantial enough to benefit.

9. **Import alias:** `@/*` maps to `./src/*`.

10. **Run `npm run build` after making changes to verify nothing is broken.** The build must pass clean.

---

## Suggested Execution Order

Tackle in batches to keep changes reviewable:

1. **Reports** (5 tables) - highest impact, data-heavy
2. **Production** (8 tables) - frequently used
3. **Core Modules** (10 tables) - model list, coordinator, estimator, etc.
4. **Admin** (7 tables) - users, contacts, companies, audit log
5. **Materials** (14 tables) - nesting, inventory, procurement
6. **Library** (1 table) - file list

Each table follows the identical 6-step pattern. The only variation is in header rendering (Pattern A/B/C) and which columns get `filterFn: excelFilterFn` vs `enableColumnFilter: false`.
