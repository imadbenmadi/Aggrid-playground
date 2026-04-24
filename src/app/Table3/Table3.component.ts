// table3.component.ts
// AG Grid 29.3.5 + Angular 14 — full learning reference
// Covers: rendering, filtering, editing, selecting, styling, transactions,
//         client-side data, grouping, pivoting, accessories, scrolling.
//
// REQUIRED packages (add to package.json):
//   "ag-grid-community": "29.3.5"
//   "ag-grid-enterprise": "29.3.5"   ← needed for grouping / pivoting / row-grouping panel
//   "ag-grid-angular": "29.3.5"
//
// REQUIRED in your AppModule (or the hosting module):
//   import { AgGridModule } from 'ag-grid-angular';
//   import { LicenseManager } from 'ag-grid-enterprise';
//   LicenseManager.setLicenseKey('YOUR_KEY');   // or use trial mode (watermark)
//
// REQUIRED global CSS (angular.json → styles):
//   "node_modules/ag-grid-community/styles/ag-grid.css"
//   "node_modules/ag-grid-community/styles/ag-theme-alpine.css"
//
// REQUIRED in THIS module's declarations:
//   Table3Component, BadgeCellRendererComponent, ActionCellRendererComponent

import {
  Component,
  OnInit,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';

// ─── Enterprise features ────────────────────────────────────────────────────
import 'ag-grid-enterprise'; // side-effects import: registers all enterprise modules

import {
  // Core types
  ColDef,
  ColGroupDef,
  GridApi,
  ColumnApi,
  GridReadyEvent,
  CellValueChangedEvent,
  SelectionChangedEvent,
  RowNode,
  ICellRendererParams,
  ICellEditorParams,
  ValueFormatterParams,
  ValueGetterParams,
  ValueSetterParams,
  GetRowIdParams,
  RowClassParams,
  RowStyle,
  CellClassParams,

  // Filter models
  IDoesFilterPassParams,
  IFilterParams,
  IFilter,

  // Transaction
  RowDataTransaction,

  // Side bar / tool panels
  SideBarDef,

  // Status bar
  StatusPanelDef,

  // Context menu
  GetContextMenuItemsParams,
  MenuItemDef,
} from 'ag-grid-community';

// ─────────────────────────────────────────────────────────────────────────────
// DATA MODEL
// ─────────────────────────────────────────────────────────────────────────────

export interface Employee {
  id: number;
  name: string;
  department: string;
  country: string;
  role: string;
  salary: number;
  rating: number;        // 1-5
  active: boolean;
  startDate: string;     // ISO
  tags: string[];        // multi-value for demo
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM CELL RENDERER — Badge
// Shows rating as coloured stars; demonstrates ICellRendererParams lifecycle.
// ─────────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-badge-cell-renderer',
  template: `
    <span class="badge-wrap">
      <span *ngFor="let s of stars; let i = index"
            [class.filled]="i < value"
            class="star">★</span>
    </span>
  `,
  styles: [`
    .badge-wrap { display:flex; gap:2px; align-items:center; }
    .star { font-size:14px; color:#ccc; transition:color .2s; }
    .star.filled { color:#f59e0b; }
  `],
})
export class BadgeCellRendererComponent {
  value = 0;
  stars = [1, 2, 3, 4, 5];

  // Called by AG Grid when the cell is created / refreshed
  agInit(params: ICellRendererParams): void {
    this.value = params.value ?? 0;
  }

  // Returning true tells the grid we handled the refresh ourselves (no re-render)
  refresh(params: ICellRendererParams): boolean {
    this.value = params.value ?? 0;
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM CELL RENDERER — Action buttons
// Demonstrates params.api (transaction delete) inside a renderer.
// ─────────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-action-cell-renderer',
  template: `
    <button class="btn-action btn-del" (click)="deleteRow()">✕</button>
    <button class="btn-action btn-dup" (click)="duplicateRow()">⎘</button>
  `,
  styles: [`
    .btn-action { border:none; cursor:pointer; border-radius:4px;
                  padding:2px 7px; font-size:12px; margin-right:3px; }
    .btn-del  { background:#fee2e2; color:#dc2626; }
    .btn-del:hover { background:#dc2626; color:#fff; }
    .btn-dup  { background:#e0f2fe; color:#0369a1; }
    .btn-dup:hover { background:#0369a1; color:#fff; }
  `],
})
export class ActionCellRendererComponent {
  private params!: ICellRendererParams;

  agInit(params: ICellRendererParams): void { this.params = params; }
  refresh(): boolean { return false; }

  deleteRow(): void {
    // TRANSACTION: remove one row without touching the rest of the data
    const tx: RowDataTransaction = { remove: [this.params.data] };
    this.params.api.applyTransaction(tx);
  }

  duplicateRow(): void {
    const newRow: Employee = {
      ...this.params.data,
      id: Date.now(),                // unique id
      name: this.params.data.name + ' (copy)',
    };
    // TRANSACTION: add at the top
    const tx: RowDataTransaction = { add: [newRow], addIndex: 0 };
    this.params.api.applyTransaction(tx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-table3',
  changeDetection: ChangeDetectionStrategy.OnPush,

  // ── Template ───────────────────────────────────────────────────────────────
  template: `
<div class="t3-root">

  <!-- ── Toolbar ──────────────────────────────────────────────────────────── -->
  <div class="toolbar">

    <!-- Quick filter -->
    <input class="t3-search" placeholder="Quick filter…"
           (input)="onQuickFilter($event)" />

    <!-- Toggle pivot mode -->
    <button class="t3-btn" (click)="togglePivot()">
      {{ pivotMode ? '✕ Exit Pivot' : '⊞ Pivot Mode' }}
    </button>

    <!-- Toggle grouping panel -->
    <button class="t3-btn" (click)="toggleRowGroupPanel()">
      Row-Group Panel {{ showGroupPanel ? 'ON' : 'OFF' }}
    </button>

    <!-- Add row (transaction) -->
    <button class="t3-btn btn-add" (click)="addRow()">+ Add Row</button>

    <!-- Update selected (transaction) -->
    <button class="t3-btn btn-upd" (click)="updateSelected()">
      ↑ Salary +10%
    </button>

    <!-- Export CSV -->
    <button class="t3-btn" (click)="exportCsv()">⬇ CSV</button>

    <!-- Scroll API demo -->
    <button class="t3-btn" (click)="scrollToMiddle()">↕ Scroll Mid</button>

    <!-- Selection count badge -->
    <span class="sel-badge" *ngIf="selectedCount > 0">
      {{ selectedCount }} selected
    </span>
  </div>

  <!-- ── Grid ─────────────────────────────────────────────────────────────── -->
  <ag-grid-angular
    #agGrid
    class="ag-theme-alpine t3-grid"

    [rowData]="rowData"
    [columnDefs]="columnDefs"
    [defaultColDef]="defaultColDef"

    [getRowId]="getRowId"

    rowSelection="multiple"
    [suppressRowClickSelection]="true"

    [editType]="'fullRow'"
    [stopEditingWhenCellsLoseFocus]="true"

    [rowGroupPanelShow]="showGroupPanel ? 'always' : 'never'"
    [pivotPanelShow]="'always'"
    [pivotMode]="pivotMode"
    [groupDefaultExpanded]="-1"
    [groupDisplayType]="'multipleColumns'"

    [getRowStyle]="getRowStyle"
    [rowClassRules]="rowClassRules"

    [statusBar]="statusBar"

    [sideBar]="sideBar"

    [getContextMenuItems]="getContextMenuItems"

    [animateRows]="true"
    [pagination]="true"
    [paginationPageSize]="15"
    [suppressMenuHide]="true"
    [enableCellChangeFlash]="true"

    (gridReady)="onGridReady($event)"
    (cellValueChanged)="onCellValueChanged($event)"
    (selectionChanged)="onSelectionChanged($event)"
  ></ag-grid-angular>

</div>
  `,

  // ── Styles ─────────────────────────────────────────────────────────────────
  styles: [`
    .t3-root {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: 'Segoe UI', sans-serif;
      background: #f0f4f8;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 10px 14px;
      background: #1e293b;
      box-shadow: 0 2px 6px rgba(0,0,0,.3);
    }
    .t3-search {
      padding: 5px 10px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      width: 180px;
      background: #334155;
      color: #e2e8f0;
      outline: none;
    }
    .t3-search::placeholder { color: #94a3b8; }
    .t3-btn {
      padding: 5px 12px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      background: #334155;
      color: #e2e8f0;
      transition: background .15s;
    }
    .t3-btn:hover { background: #475569; }
    .btn-add  { background: #166534 !important; color: #d1fae5 !important; }
    .btn-add:hover  { background: #15803d !important; }
    .btn-upd  { background: #1e3a8a !important; color: #dbeafe !important; }
    .btn-upd:hover  { background: #1d4ed8 !important; }
    .sel-badge {
      margin-left: auto;
      padding: 4px 10px;
      border-radius: 999px;
      background: #7c3aed;
      color: #ede9fe;
      font-size: 12px;
      font-weight: 600;
    }

    /* Grid fills the remaining space */
    .t3-grid {
      flex: 1;
      width: 100%;
      min-height: 0;
    }

    /* Row-level class rules */
    :host ::ng-deep .row-inactive { opacity: .5; }
    :host ::ng-deep .row-top-rated { background: #f0fdf4 !important; }

    /* Cell flash colour override */
    :host ::ng-deep .ag-cell-data-changed { background: #bfdbfe !important; }
  `],
})
export class Table3Component implements OnInit {

  @ViewChild('agGrid') agGrid!: AgGridAngular;

  // ── Grid API refs (set in onGridReady) ─────────────────────────────────────
  private gridApi!: GridApi;
  private columnApi!: ColumnApi;

  // ── UI state ───────────────────────────────────────────────────────────────
  pivotMode = false;
  showGroupPanel = true;
  selectedCount = 0;

  // ── Seed data ──────────────────────────────────────────────────────────────
  rowData: Employee[] = this.generateData(60);

  // ─────────────────────────────────────────────────────────────────────────
  // COLUMN DEFINITIONS
  // Every major ColDef feature is demonstrated at least once.
  // ─────────────────────────────────────────────────────────────────────────

  columnDefs: (ColDef | ColGroupDef)[] = [

    // ── Checkbox selection column ─────────────────────────────────────────
    {
      headerName: '',
      field: 'id',
      width: 50,
      checkboxSelection: true,          // shows checkbox in cell
      headerCheckboxSelection: true,     // shows checkbox in header (select all)
      headerCheckboxSelectionFilteredOnly: true, // only selects filtered rows
      pinned: 'left',                   // PINNING: locks to left
      lockPosition: true,
      suppressMenu: true,
      resizable: false,
      sortable: false,
      filter: false,
    },

    // ── Column GROUP — Identity ───────────────────────────────────────────
    {
      headerName: 'Identity',
      marryChildren: true,              // keep group children together
      children: [
        {
          headerName: 'ID',
          field: 'id',
          width: 70,
          hide: true,                   // hidden but can be toggled from sidebar
          filter: 'agNumberColumnFilter',
        },
        {
          headerName: 'Name',
          field: 'name',
          minWidth: 160,
          editable: true,               // INLINE EDITING: text (uses agTextCellEditor)
          cellEditor: 'agTextCellEditor',
          filter: 'agTextColumnFilter', // FILTERING: text filter
          floatingFilter: true,         // shows filter input below header
          // valueFormatter: not needed for strings — shown on salary below
          // cellStyle from function:
          cellStyle: (p: CellClassParams) => p.value?.includes('(copy)')
            ? { fontStyle: 'italic', color: '#6366f1' }
            : null,
          rowDrag: true,               // ROW DRAG: grab handle
        },
      ],
    },

    // ── Column GROUP — Organisation ───────────────────────────────────────
    {
      headerName: 'Organisation',
      children: [
        {
          headerName: 'Department',
          field: 'department',
          minWidth: 140,
          editable: true,
          cellEditor: 'agSelectCellEditor', // EDITING: dropdown
          cellEditorParams: {
            values: ['Engineering', 'Product', 'Design', 'Sales', 'HR', 'Finance'],
          },
          filter: 'agSetColumnFilter',  // FILTERING: set (checkbox list)
          floatingFilter: true,
          enableRowGroup: true,         // can be dragged to row-group panel
          enablePivot: true,            // can be used as pivot column
          rowGroup: true,               // starts grouped by default
          hide: true,                   // hidden because grouped (standard pattern)
        },
        {
          headerName: 'Country',
          field: 'country',
          minWidth: 120,
          filter: 'agSetColumnFilter',
          floatingFilter: true,
          enableRowGroup: true,
          enablePivot: true,
          // CUSTOM CELL RENDERER via function (inline — no separate component)
          cellRenderer: (params: ICellRendererParams) => {
            const flags: Record<string, string> = {
              Hungary: '🇭🇺', Germany: '🇩🇪', France: '🇫🇷',
              Spain: '🇪🇸', UK: '🇬🇧', USA: '🇺🇸',
            };
            return `${flags[params.value] ?? '🌐'} ${params.value}`;
          },
        },
        {
          headerName: 'Role',
          field: 'role',
          minWidth: 130,
          editable: true,
          cellEditor: 'agTextCellEditor',
          filter: 'agTextColumnFilter',
          floatingFilter: true,
        },
      ],
    },

    // ── Column GROUP — Metrics ────────────────────────────────────────────
    {
      headerName: 'Metrics',
      children: [
        {
          headerName: 'Salary (€)',
          field: 'salary',
          minWidth: 130,
          editable: true,
          cellEditor: 'agNumberCellEditor', // EDITING: numeric
          filter: 'agNumberColumnFilter',   // FILTERING: number (range slider possible)
          floatingFilter: true,
          enableValue: true,               // can be aggregated in pivot
          aggFunc: 'avg',                  // default aggregation
          allowedAggFuncs: ['sum', 'avg', 'min', 'max'],
          // VALUE FORMATTER: display 1234 as "€ 1,234"
          valueFormatter: (p: ValueFormatterParams) =>
            p.value != null
              ? '€ ' + (p.value as number).toLocaleString('en-GB', { maximumFractionDigits: 0 })
              : '',
          // VALUE GETTER — alternative to field; commented out to avoid conflict
          // valueGetter: (p: ValueGetterParams) => p.data?.salary,
          //
          // CELL CLASS RULES: colour by salary band
          cellClassRules: {
            'cell-high': (p: CellClassParams) => p.value >= 90_000,
            'cell-medium': (p: CellClassParams) => p.value >= 60_000 && p.value < 90_000,
            'cell-low': (p: CellClassParams) => p.value < 60_000,
          },
          // VALUE SETTER: convert string input back to number
          valueSetter: (p: ValueSetterParams): boolean => {
            const parsed = Number(p.newValue);
            if (isNaN(parsed)) return false;
            p.data.salary = parsed;
            return true;
          },
        },
        {
          headerName: 'Rating',
          field: 'rating',
          width: 130,
          editable: true,
          cellEditor: 'agNumberCellEditor',
          cellEditorParams: { min: 1, max: 5 },
          filter: 'agNumberColumnFilter',
          floatingFilter: true,
          enableValue: true,
          aggFunc: 'avg',
          // CUSTOM COMPONENT RENDERER
          cellRenderer: BadgeCellRendererComponent,
        },
        {
          headerName: 'Active',
          field: 'active',
          width: 90,
          editable: true,
          cellEditor: 'agCheckboxCellEditor', // EDITING: checkbox toggle
          cellRenderer: 'agCheckboxCellRenderer',
          filter: 'agSetColumnFilter',
          floatingFilter: true,
        },
        {
          headerName: 'Start Date',
          field: 'startDate',
          minWidth: 130,
          editable: true,
          cellEditor: 'agDateStringCellEditor', // EDITING: date picker
          filter: 'agDateColumnFilter',          // FILTERING: date range
          floatingFilter: true,
          valueFormatter: (p: ValueFormatterParams) =>
            p.value ? new Date(p.value).toLocaleDateString('en-GB') : '',
          sort: 'desc',                          // default sort direction
        },
      ],
    },

    // ── Computed column (valueGetter, no field) ───────────────────────────
    {
      headerName: 'Seniority',
      colId: 'seniority',              // explicit ID because no field
      valueGetter: (p: ValueGetterParams): string => {
        const s = p.data?.salary ?? 0;
        if (s >= 90_000) return 'Senior';
        if (s >= 60_000) return 'Mid';
        return 'Junior';
      },
      filter: 'agSetColumnFilter',
      floatingFilter: true,
      enableRowGroup: true,
      enablePivot: true,
    },

    // ── Tooltip column ────────────────────────────────────────────────────
    {
      headerName: 'Tags',
      field: 'tags',
      minWidth: 120,
      // Render first tag; show all in tooltip
      cellRenderer: (p: ICellRendererParams) =>
        Array.isArray(p.value) ? p.value.join(', ') : '',
      tooltipValueGetter: (p) =>
        Array.isArray(p.value) ? p.value.join(' · ') : '',
      filter: false,
    },

    // ── Actions (pinned right) ────────────────────────────────────────────
    {
      headerName: 'Actions',
      colId: 'actions',
      pinned: 'right',
      width: 100,
      sortable: false,
      filter: false,
      suppressMenu: true,
      editable: false,
      cellRenderer: ActionCellRendererComponent, // CUSTOM RENDERER
    },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // DEFAULT COL DEF — inherited by every column unless overridden
  // ─────────────────────────────────────────────────────────────────────────

  defaultColDef: ColDef = {
    resizable: true,
    sortable: true,
    filter: true,
    // tooltipShowDelay: 300,
    minWidth: 80,
    // Enable floating filter globally
    floatingFilter: false, // overridden per column where needed
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ROW ID — required for transactions and stable row identity
  // ─────────────────────────────────────────────────────────────────────────

  getRowId = (params: GetRowIdParams): string => String(params.data.id);

  // ─────────────────────────────────────────────────────────────────────────
  // ROW STYLING
  // Two APIs shown: getRowStyle (function) and rowClassRules (object map)
  // ─────────────────────────────────────────────────────────────────────────

  // getRowStyle: full inline style object from function
  getRowStyle = (params: RowClassParams): RowStyle | undefined => {
    if (params.node.group) {
      // GROUP ROWS: dark header-like background
      return { background: '#1e293b', color: '#e2e8f0', fontWeight: '600' };
    }
    return undefined;
  };

  // rowClassRules: map of CSS class → boolean predicate
  rowClassRules = {
    'row-inactive': (p: RowClassParams) => p.data && !p.data.active,
    'row-top-rated': (p: RowClassParams) => p.data && p.data.rating === 5,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STATUS BAR — bottom accessories
  // ─────────────────────────────────────────────────────────────────────────

  statusBar: { statusPanels: StatusPanelDef[] } = {
    statusPanels: [
      { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
      { statusPanel: 'agTotalRowCountComponent', align: 'center' },
      { statusPanel: 'agFilteredRowCountComponent' },
      { statusPanel: 'agSelectedRowCountComponent' },
      { statusPanel: 'agAggregationComponent' },           // shows sum/avg when cells selected
    ],
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SIDE BAR — column / filter tool panels
  // ─────────────────────────────────────────────────────────────────────────

  sideBar: SideBarDef = {
    toolPanels: [
      {
        id: 'columns',
        labelDefault: 'Columns',
        labelKey: 'columns',
        iconKey: 'columns',
        toolPanel: 'agColumnsToolPanel',
        toolPanelParams: {
          suppressRowGroups: false,
          suppressValues: false,
          suppressPivots: false,
          suppressPivotMode: false,
        },
      },
      {
        id: 'filters',
        labelDefault: 'Filters',
        labelKey: 'filters',
        iconKey: 'filter',
        toolPanel: 'agFiltersToolPanel',
      },
    ],
    defaultToolPanel: 'columns',
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CONTEXT MENU — right-click
  // ─────────────────────────────────────────────────────────────────────────

  getContextMenuItems = (params: GetContextMenuItemsParams): (MenuItemDef | string)[] => [
    'copy',
    'copyWithHeaders',
    'separator',
    {
      name: 'Mark as Inactive',
      icon: '<span style="font-size:12px">🔴</span>',
      action: () => {
        if (!params.node?.data) return;
        const updated: Employee = { ...params.node.data, active: false };
        // TRANSACTION: update a single row
        this.gridApi.applyTransaction({ update: [updated] });
      },
    },
    {
      name: 'Export Selected',
      icon: '<span style="font-size:12px">⬇</span>',
      action: () => this.gridApi.exportDataAsCsv({ onlySelected: true }),
    },
    'separator',
    'chartRange',   // enterprise: create chart from selection
    'expandAll',
    'contractAll',
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    // Inject cell class styles dynamically (alternative to global stylesheet)
    const style = document.createElement('style');
    style.textContent = `
      .cell-high   { background: #d1fae5 !important; color: #065f46; font-weight:600; }
      .cell-medium { background: #fef9c3 !important; color: #713f12; }
      .cell-low    { background: #fee2e2 !important; color: #991b1b; }
    `;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GRID EVENTS
  // ─────────────────────────────────────────────────────────────────────────

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
    this.columnApi = event.columnApi;

    // Auto-size all columns on first load
    this.columnApi.autoSizeAllColumns();

    // COLUMN STATE: programmatically sort by startDate desc
    this.columnApi.applyColumnState({
      state: [{ colId: 'startDate', sort: 'desc' }],
      defaultState: { sort: null },
    });
  }

  onCellValueChanged(event: CellValueChangedEvent): void {
    // TRANSACTION: push the edited row back as an update so getRowId can
    // match it and the grid doesn't re-render everything.
    // In fullRow edit mode this fires once after the row is committed.
    const tx: RowDataTransaction = { update: [event.data] };
    this.gridApi.applyTransaction(tx);

    console.log('[Table3] Cell changed', {
      field: event.colDef.field,
      oldValue: event.oldValue,
      newValue: event.newValue,
      row: event.data,
    });
  }

  onSelectionChanged(event: SelectionChangedEvent): void {
    this.selectedCount = this.gridApi.getSelectedRows().length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOOLBAR HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  onQuickFilter(event: Event): void {
    // FILTERING: client-side quick filter (searches all columns)
    this.gridApi.setQuickFilter((event.target as HTMLInputElement).value);
  }

  togglePivot(): void {
    this.pivotMode = !this.pivotMode;
    // COLUMN API: toggle pivot mode programmatically
    this.columnApi.setPivotMode(this.pivotMode);
  }

  toggleRowGroupPanel(): void {
    this.showGroupPanel = !this.showGroupPanel;
  }

  addRow(): void {
    const newRow: Employee = {
      id: Date.now(),
      name: 'New Employee',
      department: 'Engineering',
      country: 'Hungary',
      role: 'Developer',
      salary: 55_000,
      rating: 3,
      active: true,
      startDate: new Date().toISOString().slice(0, 10),
      tags: ['new'],
    };
    // TRANSACTION: add to top; grid animates the insertion
    const result = this.gridApi.applyTransaction({ add: [newRow], addIndex: 0 });
    console.log('[Table3] addRow result', result);

    // Start editing the name cell immediately
    this.gridApi.startEditingCell({ rowIndex: 0, colKey: 'name' });
  }

  updateSelected(): void {
    const selected: Employee[] = this.gridApi.getSelectedRows();
    if (!selected.length) return;

    // TRANSACTION: batch update multiple rows at once
    const updated = selected.map(row => ({
      ...row,
      salary: Math.round(row.salary * 1.1),
    }));
    const result = this.gridApi.applyTransaction({ update: updated });
    console.log('[Table3] updateSelected result', result);
  }

  exportCsv(): void {
    this.gridApi.exportDataAsCsv({
      fileName: 'employees.csv',
      columnSeparator: ',',
      // Only export visible columns (skips hidden ones)
      allColumns: false,
    });
  }

  scrollToMiddle(): void {
    // SCROLLING API: scroll to a specific row by index
    const rowCount = this.gridApi.getDisplayedRowCount();
    const midIndex = Math.floor(rowCount / 2);
    this.gridApi.ensureIndexVisible(midIndex, 'middle');

    // Also scroll to a specific column
    this.gridApi.ensureColumnVisible('salary');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DATA GENERATION
  // ─────────────────────────────────────────────────────────────────────────

  private generateData(count: number): Employee[] {
    const departments = ['Engineering', 'Product', 'Design', 'Sales', 'HR', 'Finance'];
    const countries = ['Hungary', 'Germany', 'France', 'Spain', 'UK', 'USA'];
    const roles = ['Developer', 'Manager', 'Analyst', 'Designer', 'Lead', 'VP'];
    const tagPool = ['remote', 'on-site', 'part-time', 'contractor', 'intern', 'full-time'];
    const names = [
      'Imed', 'Sara', 'Lena', 'Max', 'Amara', 'Kai', 'Noor', 'Felix',
      'Priya', 'Tom', 'Yuki', 'Omar', 'Elena', 'Diego', 'Asel',
    ];

    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: names[i % names.length] + ' ' + String.fromCharCode(65 + (i % 26)),
      department: departments[i % departments.length],
      country: countries[i % countries.length],
      role: roles[i % roles.length],
      salary: 40_000 + Math.round(Math.random() * 80_000),
      rating: (1 + (i % 5)) as 1 | 2 | 3 | 4 | 5,
      active: i % 7 !== 0,
      startDate: new Date(2018 + (i % 6), i % 12, 1 + (i % 28))
        .toISOString().slice(0, 10),
      tags: [tagPool[i % tagPool.length], tagPool[(i + 2) % tagPool.length]],
    }));
  }
}
