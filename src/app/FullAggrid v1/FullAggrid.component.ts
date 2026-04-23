import { Component, OnInit, OnDestroy } from '@angular/core';
import {
  ColDef,
  ColGroupDef,
  GridApi,
  GridReadyEvent,
  FirstDataRenderedEvent,
  IRowNode,
  RowClassParams,
  RowStyle,
  SortChangedEvent,
  FilterChangedEvent,
  PaginationChangedEvent,
  CellValueChangedEvent,
  ColumnResizedEvent,
  GridSizeChangedEvent,
  ValueFormatterParams,
  ValueGetterParams,
  ICellRendererParams, StatusPanelDef, SideBarDef
} from 'ag-grid-community';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime } from 'rxjs/operators';
import { delay } from 'rxjs/operators';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OlympicRow {
  id: number;
  athlete: string;
  age: number;
  country: string;
  year: number;
  date: string;
  sport: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
  salary?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-selection',
  templateUrl: './FullAggrid.component.html',
  styleUrls: ['./FullAggrid.component.scss'],
})
export class FullAggridComponent implements OnInit, OnDestroy {
  private timerId?: ReturnType<typeof setInterval>;
  private readonly refreshIntervalMs = 1000;

  // Set > 0 if you want to *see* the loading overlay longer.
  // Keep this < refreshIntervalMs to avoid overlapping requests.
  private readonly requestDelayMs = 0;
  // ── Grid API reference ──────────────────────────────────────────────────────
  private gridApi?: GridApi;

  // Keep overlay state even if load starts before gridReady
  private isLoading = false;

  // ── Destroy signal for RxJS subscriptions ───────────────────────────────────
  // takeUntil(this.destroy$) ensures no memory leaks from open subscriptions
  private destroy$ = new Subject<void>();

  // ── Debounce subject for localStorage writes ─────────────────────────────────
  // Avoids hammering localStorage on rapid selection changes (e.g. selectAll on 10k rows)
  private selectionChange$ = new Subject<OlympicRow[]>();

  // ── Public state bound to the template ──────────────────────────────────────
  public rowData: OlympicRow[] = [];
  public selectedRows: OlympicRow[] = [];
  public selectedCount = 0;
  public totalMedals = 0;
  public error = '';
  public quickFilterText = '';

  private setGridLoading(isLoading: boolean): void {
    this.isLoading = isLoading;

    if (!this.gridApi) return;

    if (isLoading) {
      this.gridApi.showLoadingOverlay();
    } else {
      this.gridApi.hideOverlay();
    }
  }

  // ─── Column Definitions ─────────────────────────────────────────────────────
  //
  // ColDef vs ColGroupDef:
  //   ColDef       → single column
  //   ColGroupDef  → grouped header spanning multiple ColDefs (see "Medals" group below)
  //
  // Key ColDef properties covered here:
  //   field            → maps to the property on rowData
  //   headerName       → display label in the header
  //   sortable         → enables click-to-sort
  //   filter           → enables the filter icon; true = default filter per data type
  //   resizable        → user can drag column edges
  //   pinned           → 'left' | 'right' locks column during horizontal scroll
  //   width / minWidth → pixel sizing
  //   hide             → column exists but is not rendered (useful for export)
  //   editable         → makes the cell inline-editable (see onCellValueChanged)
  //   valueFormatter   → transforms the raw value for display only (doesn't affect sort/filter)
  //   valueGetter      → computes a derived value; used here for "Total" column
  //   cellRenderer     → custom render function; used here for medal count badges
  //   cellClass        → static CSS class on the cell element
  //   cellClassRules   → conditional CSS classes based on cell value
  //   comparator       → custom sort function for the column
  //   checkboxSelection       → renders a checkbox in the cell
  //   headerCheckboxSelection → renders a "select all" checkbox in the header

  public statusBar: {
    statusPanels: StatusPanelDef[];
  } = {
      statusPanels: [
        { statusPanel: "agTotalRowCountComponent", align: "left" },
        { statusPanel: "agFilteredRowCountComponent" },
        { statusPanel: "agSelectedRowCountComponent" },
        { statusPanel: "agAggregationComponent" },
      ],
    };

  public sideBar: SideBarDef = {
    toolPanels: [
      {
        id: 'columns',
        labelDefault: 'Columns',
        labelKey: 'columns',
        iconKey: 'columns',
        toolPanel: 'agColumnsToolPanel',
        toolPanelParams: {
          // This hides the Pivot Mode toggle and sections
          suppressPivotMode: true,
          // Optional: hide the "Row Groups" and "Values" sections too
          suppressRowGroups: true,
          suppressValues: true,
          suppressColumnFilter: false,
          suppressColumnSelectAll: false,
          suppressColumnExpandAll: false,
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

  public columnDefs: (ColDef | ColGroupDef)[] = [

    // ── Checkbox column ────────────────────────────────────────────────────────
    {
      headerName: '',
      field: 'checkbox',
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      pinned: 'left' as const,
      resizable: false,
      sortable: false,
      filter: false,
      checkboxSelection: true,
      headerCheckboxSelection: true,
      // Locks this column so it can't be dragged to another position
      lockPosition: true,
      // Suppress the column from appearing in the column tool panel
      suppressColumnsToolPanel: true,
    },

    // ── Basic columns ──────────────────────────────────────────────────────────
    {
      headerName: 'Athlete',
      field: 'athlete',
      sortable: true,
      filter: 'agTextColumnFilter',   // text-specific filter: contains, starts with, etc.
      resizable: true,
      minWidth: 150,
      pinned: 'left' as const,
      // cellClassRules: apply CSS classes conditionally based on the cell's value
      cellClassRules: {
        'font-bold': (params) => params.value?.length > 20,
      },
    },
    {
      headerName: 'Age',
      field: 'age',
      sortable: true,
      filter: 'agNumberColumnFilter',  // number filter: equals, greater than, less than
      resizable: true,
      width: 80,
      // valueFormatter: formats display value — raw value stays unchanged for sort/filter
      valueFormatter: (params: ValueFormatterParams) =>
        params.value != null ? `${params.value} yrs` : '—',
    },
    {
      headerName: 'Country',
      field: 'country',
      sortable: true,
      filter: 'agSetColumnFilter',    // set filter: shows a checkbox list of unique values
      resizable: true,
      minWidth: 120,
    },
    {
      headerName: 'Year',
      field: 'year',
      sortable: true,
      filter: 'agNumberColumnFilter',
      resizable: true,
      width: 90,
    },
    {
      headerName: 'Sport',
      field: 'sport',
      sortable: true,
      filter: 'agSetColumnFilter',
      resizable: true,
      minWidth: 120,
    },

    // ── Column Group: Medals ────────────────────────────────────────────────────
    // ColGroupDef wraps multiple ColDefs under a shared spanning header
    {
      headerName: 'Medals',
      // groupId is used when referencing the group programmatically
      groupId: 'medalsGroup',
      // marryChildren: prevents individual children from being moved outside the group
      marryChildren: true,
      children: [
        {
          headerName: '🥇',
          field: 'gold',
          sortable: true,
          filter: 'agNumberColumnFilter',
          resizable: true,
          width: 80,
          // cellRenderer: custom render function — return an HTML string or DOM element
          // Use sparingly; heavy renderers on large grids hurt scroll performance
          cellRenderer: (params: ICellRendererParams) =>
            params.value > 0
              ? `<span style="color: black; font-weight: 600;">${params.value}</span>`
              : `<span style="color: black;">0</span>`,
        },
        {
          headerName: '🥈',
          field: 'silver',
          sortable: true,
          filter: 'agNumberColumnFilter',
          resizable: true,
          width: 80,
          cellRenderer: (params: ICellRendererParams) =>
            params.value > 0
              ? `<span style="color: black; font-weight: 600;">${params.value}</span>`
              : `<span style="color:black;">0</span>`,
        },
        {
          headerName: '🥉',
          field: 'bronze',
          sortable: true,
          filter: 'agNumberColumnFilter',
          resizable: true,
          width: 80,
          cellRenderer: (params: ICellRendererParams) =>
            params.value > 0
              ? `<span style="color: black; font-weight: 600;">${params.value}</span>`
              : `<span style="color: black;">0</span>`,
        },
        {
          headerName: 'Total',
          // valueGetter: computes a value from other fields — no `field` needed
          // This is the correct way to show a derived value (not a stored property)
          valueGetter: (params: ValueGetterParams) =>
            (params.data.gold ?? 0) +
            (params.data.silver ?? 0) +
            (params.data.bronze ?? 0),
          sortable: true,
          filter: 'agNumberColumnFilter',
          resizable: true,
          width: 80,
        },
      ],
    },

    // ── Editable column ────────────────────────────────────────────────────────
    {
      headerName: 'Salary',
      field: 'salary',
      sortable: true,
      filter: 'agNumberColumnFilter',
      resizable: true,
      width: 120,
      editable: true,   // double-click to edit inline
      valueFormatter: (params: ValueFormatterParams) =>
        params.value != null
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.value)
          : '—',
      // cellClassRules: highlight high earners
      cellClassRules: {
        'high-salary': (params) => (params.value ?? 0) > 100000,
      },
    },

    // ── Hidden column (still available in data / export, not rendered) ──────────
    {
      headerName: 'Date',
      field: 'date',
      hide: true,
    },
  ];

  // ─── Default Column Definition ───────────────────────────────────────────────
  // Applied to every column unless overridden at the ColDef level
  public defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    // suppressMovable: false means columns CAN be dragged to reorder (default)
    suppressMovable: false,
  };

  // ─── Grid Options ────────────────────────────────────────────────────────────

  // Pagination: splits rowData into pages
  public pagination = true;
  public paginationPageSize = 50;

  // animateRows: smooth row reordering on sort — disable on very large datasets
  public animateRows = true;

  // rowBuffer: how many rows to render outside the visible viewport
  // Higher = smoother scroll, higher memory. Default is 10.
  public rowBuffer = 20;

  // getRowId: stable identity per row — required for:
  //   - selection restore after data reload
  //   - row transactions (add/update/remove without full re-render)
  //   - deltaRowDataMode
  public getRowId = (params: any): string => params.data.id.toString();

  // getRowStyle: apply inline styles conditionally per row
  // Less performant than getRowClass for many rows — prefer getRowClass
  public getRowStyle = (params: RowClassParams): RowStyle | undefined => {
    if (params.node.isSelected()) {
      return { background: '#fff3f3' };
    }
    return undefined;
  };

  // getRowClass: apply CSS class strings conditionally per row
  // More performant than getRowStyle — class toggling is cheaper than inline style recalc
  public getRowClass = (params: RowClassParams): string | string[] | undefined => {
    if (params.data?.gold > 3) return 'champion-row';
    return undefined;
  };

  constructor(private http: HttpClient) { }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  ngOnInit(): void {
    // Debounce localStorage writes — on selectAll(10k rows), onSelectionChanged
    // fires once per row. Without debounce you'd serialize 10k rows to JSON 10k times.
    this.selectionChange$
      .pipe(
        debounceTime(300),       // wait 300ms after last emission before writing
        takeUntil(this.destroy$) // auto-unsubscribe on component destroy
      )
      .subscribe(rows => {
        localStorage.setItem('selectedRows', JSON.stringify(rows));
      });

    this.loadData();

    // Refresh data on an interval (separate from selection changes)
    this.startAutoRefresh();
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    this.timerId = setInterval(() => this.refetch(), this.refreshIntervalMs);
  }

  private stopAutoRefresh(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = undefined;
    }
  }

  refetch(): void {
    // Prevent piling up requests if one is still in flight
    if (this.isLoading) return;
    this.loadData();
  }

  ngOnDestroy(): void {
    // Completes all takeUntil subscriptions — prevents memory leaks
    this.destroy$.next();
    this.destroy$.complete();
    this.stopAutoRefresh();
  }

  // ─── Data Loading ────────────────────────────────────────────────────────────

  // private loadData(): void {
  //   this.http
  //     .get<any[]>('https://www.ag-grid.com/example-assets/olympic-winners.json')
  //     .pipe(takeUntil(this.destroy$)) // cancel HTTP if component is destroyed mid-request
  //     .subscribe({
  //       next: (data) => {
  //         this.rowData = data.map((item, index) => ({
  //           id: index + 1,
  //           salary: Math.floor(Math.random() * 200000) + 30000, // demo value
  //           ...item,
  //         }));
  //         this.loading = false;
  //       },
  //       error: (err) => {
  //         console.error(err);
  //         this.error = 'Failed to load data.';
  //         this.loading = false;
  //       },
  //     });
  // }
  private loadData(): void {
    this.error = '';
    this.setGridLoading(true);
    this.http
      .get<any[]>('https://www.ag-grid.com/example-assets/olympic-winners.json')
      .pipe(
        delay(this.requestDelayMs),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (data) => {
          this.rowData = data.map((item, index) => ({
            id: index + 1,
            salary: Math.floor(Math.random() * 200000) + 30000,
            ...item,
          }));
          this.setGridLoading(false);
          if (this.rowData.length === 0) {
            this.gridApi?.showNoRowsOverlay();
          }
        },
        error: (err) => {
          console.error(err);
          this.error = 'Failed to load data.';
          this.rowData = [];
          this.setGridLoading(false);
          this.gridApi?.showNoRowsOverlay();
        },
      });
  }

  // ─── Grid Events ─────────────────────────────────────────────────────────────

  onGridReady(params: GridReadyEvent): void {
    const api = params.api;
    this.gridApi = api;

    if (this.isLoading) {
      api.showLoadingOverlay();
    } else if (!this.error && this.rowData.length === 0) {
      api.showNoRowsOverlay();
    }

    // sizeColumnsToFit: fills the grid width by proportionally resizing all columns
    // autoSizeAllColumns: resizes each column to fit its content — expensive on large data
    // Use sizeColumnsToFit for initial load, autoSizeAllColumns only when needed
    api.sizeColumnsToFit();
    // this.gridApi.suppressCellSelection = true; // prevents cell-level selection (we use row-level with checkboxes)
  }

  // Fires after the first batch of rows is rendered in the DOM
  // This is the correct place to restore selection — grid is fully ready
  onFirstDataRendered(_params: FirstDataRenderedEvent): void {
    this.restoreSelection();
  }

  onSelectionChanged(): void {
    if (!this.gridApi) return;
    this.selectedRows = this.gridApi.getSelectedRows();
    // Compute aggregates here — NOT in the template as method calls
    this.selectedCount = this.selectedRows.length;
    this.totalMedals = this.selectedRows.reduce(
      (sum, row) => sum + (row.gold ?? 0) + (row.silver ?? 0) + (row.bronze ?? 0),
      0
    );
    // Push to debounced subject instead of writing to localStorage directly
    this.selectionChange$.next(this.selectedRows);
  }

  // Fires when the user edits a cell inline (editable: true)
  onCellValueChanged(event: CellValueChangedEvent): void {
    console.log(`Cell changed: field=${event.colDef.field}, old=${event.oldValue}, new=${event.newValue}`);
    // Here you'd typically call an API to persist the change
    // event.data contains the full updated row object
  }

  // Fires when a sort is applied — useful for analytics or saving grid state
  onSortChanged(_event: SortChangedEvent): void {
    // Sort model can be retrieved via gridApi.getColumnState()
    console.log('Sort changed event fired');
  }

  // Fires when a filter changes — useful for saving filter state
  onFilterChanged(_event: FilterChangedEvent): void {
    if (!this.gridApi) return;
    const filterModel = this.gridApi.getFilterModel();
    console.log('Filter model:', filterModel);
    // To restore: this.gridApi.setFilterModel(savedFilterModel);
  }

  onPaginationChanged(_event: PaginationChangedEvent): void {
    // Fires on page change, page size change, or data reload
    // Use this.gridApi.paginationGetCurrentPage() to get current page index
  }

  // Fires when the grid container is resized — keep columns filling the width
  onGridSizeChanged(_event: GridSizeChangedEvent): void {
    if (!this.gridApi) return;
    this.gridApi.sizeColumnsToFit();
  }

  // ─── Selection Helpers ───────────────────────────────────────────────────────

  private restoreSelection(): void {
    if (!this.gridApi) return;
    const savedRows: OlympicRow[] = JSON.parse(
      localStorage.getItem('selectedRows') || '[]'
    );
    if (!savedRows.length) return;

    const savedIds = new Set(savedRows.map((r) => r.id.toString()));

    // forEachNode iterates ALL row nodes including filtered-out ones
    // Use forEachNodeAfterFilter if you only want visible rows
    this.gridApi.forEachNode((node: IRowNode) => {
      if (node.data && savedIds.has(node.data.id.toString())) {
        // Note: onSelectionChanged still fires per-node during restore;
        // the debounced selectionChange$ subject prevents excessive localStorage writes
        node.setSelected(true, false);
      }
    });

    // Manually sync state once after bulk restore
    this.onSelectionChanged();
  }

  selectAll(): void {
    if (!this.gridApi) return;
    // selectAll() only selects rows passing the current filter
    this.gridApi.selectAll();
  }

  deselectAll(): void {
    if (!this.gridApi) return;
    this.gridApi.deselectAll();
  }

  deleteSelected(): void {
    const selectedIds = new Set(this.selectedRows.map((r) => r.id));
    this.rowData = this.rowData.filter((row) => !selectedIds.has(row.id));
    this.selectedRows = [];
    this.selectedCount = 0;
    this.totalMedals = 0;
    localStorage.removeItem('selectedRows');
  }

  // ─── Quick Filter ─────────────────────────────────────────────────────────────
  // quickFilterText bound to an input in the template
  // AG Grid searches across all column values automatically
  onQuickFilterChange(value: string): void {
    this.quickFilterText = value;
    // Alternatively call directly: this.gridApi.setQuickFilter(value);
    // Using [quickFilterText] binding on the grid component is cleaner
  }

  // ─── Export ───────────────────────────────────────────────────────────────────

  exportCsv(): void {
    if (!this.gridApi) return;
    this.gridApi.exportDataAsCsv({
      fileName: 'olympic-data.csv',
      // onlySelected: true → export only checked rows
      onlySelected: this.selectedRows.length > 0,
      // columnKeys: limit which columns appear in the export
      // columnKeys: ['athlete', 'country', 'gold', 'silver', 'bronze'],
    });
  }

  // ─── Column State (save/restore column order, width, visibility) ──────────────

  saveColumnState(): void {
    if (!this.gridApi) return;
    const state = this.gridApi.getColumnState();
    localStorage.setItem('columnState', JSON.stringify(state));
  }

  restoreColumnState(): void {
    if (!this.gridApi) return;
    const saved = localStorage.getItem('columnState');
    if (saved) {
      this.gridApi.applyColumnState({
        state: JSON.parse(saved),
        applyOrder: true, // also restores column order
      });
    }
  }

  // ─── Row Transactions (efficient partial updates) ─────────────────────────────
  // Instead of replacing the entire rowData array, you can add/update/remove
  // specific rows without a full grid re-render. Requires getRowId to be set.

  addRow(newRow: OlympicRow): void {
    if (!this.gridApi) return;
    this.gridApi.applyTransaction({ add: [newRow], addIndex: 0 });
  }

  updateRow(updatedRow: OlympicRow): void {
    if (!this.gridApi) return;
    this.gridApi.applyTransaction({ update: [updatedRow] });
  }

  removeRow(row: OlympicRow): void {
    if (!this.gridApi) return;
    this.gridApi.applyTransaction({ remove: [row] });
  }
  getSelectedCount(): number {
    return this.selectedCount;
  }

  getTotalSalary(): number {
    return this.selectedRows.reduce((sum, row) => sum + (row.salary ?? 0), 0);
  }

  public rowSelection: 'multiple' = 'multiple';
  public suppressRowClickSelection = true;

  onRowClicked(params: any): void {
    if (!this.gridApi) return;
    const mouseEvent = params.event;

    // Identify if the click was specifically on the checkbox element
    const isCheckboxClick = mouseEvent.target.closest('.ag-selection-checkbox');

    if (!isCheckboxClick) {
      // SCENARIO: User clicked the ROW (not the checkbox)
      // We want to ADD this row to the selection without removing others
      params.node.setSelected(true, false);
    } else {
      // SCENARIO: User clicked the CHECKBOX
      // If it's already selected, we want to UNSELECT it.
      // Note: Since suppressRowClickSelection is true, we handle the toggle manually
      const isSelected = params.node.isSelected();
      params.node.setSelected(!isSelected);
    }
  }
}
