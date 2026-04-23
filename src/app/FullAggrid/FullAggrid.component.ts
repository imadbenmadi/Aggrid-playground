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
  GridSizeChangedEvent,
  ValueFormatterParams,
  ValueGetterParams,
  ICellRendererParams,
  StatusPanelDef,
  SideBarDef,
} from 'ag-grid-community';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, delay } from 'rxjs/operators';

// ─── Row shape ────────────────────────────────────────────────────────────────

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
  selector: 'app-full-aggrid',
  templateUrl: './FullAggrid.component.html',
  styleUrls: ['./FullAggrid.component.scss'],
})
export class FullAggridComponent implements OnInit, OnDestroy {
  // ── Auto-refresh ─────────────────────────────────────────────────────────────
  private timerId?: ReturnType<typeof setInterval>;
  private readonly REFRESH_INTERVAL_MS = 30_000;   // poll every 30s
  private readonly FETCH_DELAY_MS = 3_000;

  // ── Grid API ─────────────────────────────────────────────────────────────────
  // Stored on gridReady; used to call imperative grid methods
  private gridApi?: GridApi;
  private isFetching = false;

  // ── RxJS ─────────────────────────────────────────────────────────────────────
  private destroy$ = new Subject<void>();  // completes all subscriptions on destroy
  private selectionSave$ = new Subject<OlympicRow[]>(); // debounced localStorage writes

  // ── Template-bound state ─────────────────────────────────────────────────────
  public rowData: OlympicRow[] = [];
  public selectedRows: OlympicRow[] = [];
  public selectedCount = 0;
  public totalMedals = 0;
  public totalSalary = 0;
  public errorMsg = '';
  public isLoading = false;
  public quickFilter = '';

  // ─── Row Selection ────────────────────────────────────────────────────────────
  // 'multiple' + suppressRowClickSelection → selection only via checkbox/API calls
  public rowSelection: 'multiple' = 'multiple';
  // public suppressRowClickSelection = true;
  public suppressRowClickSelection = true;

  // ─── Status Bar ───────────────────────────────────────────────────────────────
  // Panels shown at the bottom of the grid
  public statusBar: { statusPanels: StatusPanelDef[] } = {
    statusPanels: [
      { statusPanel: 'agTotalRowCountComponent', align: 'left' },
      { statusPanel: 'agFilteredRowCountComponent', align: 'left' },
      { statusPanel: 'agSelectedRowCountComponent', align: 'center' },
      { statusPanel: 'agAggregationComponent', align: 'right' },
    ],
  };

  // ─── Side Bar ─────────────────────────────────────────────────────────────────
  // Columns + Filters panels on the right edge
  public sideBar: SideBarDef = {
    toolPanels: [
      {
        id: 'columns',
        labelDefault: 'Columns',
        labelKey: 'columns',
        iconKey: 'columns',
        toolPanel: 'agColumnsToolPanel',
        toolPanelParams: {
          suppressPivotMode: true,   // hide Pivot Mode toggle
          suppressRowGroups: true,
          suppressValues: true,
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
    defaultToolPanel: '', // collapsed by default
  };

  // ─── Column Definitions ───────────────────────────────────────────────────────
  public columnDefs: (ColDef | ColGroupDef)[] = [

    // ── Checkbox ─────────────────────────────────────────────────────────────────
    // checkboxSelection + headerCheckboxSelection give select-all in header
    {
      headerName: '',
      field: 'checkbox',
      width: 50, minWidth: 50, maxWidth: 50,
      pinned: 'left',
      resizable: false, sortable: false, filter: false,
      checkboxSelection: true,
      headerCheckboxSelection: true,
      lockPosition: true,
      suppressColumnsToolPanel: true, // hide from column panel
    },

    // ── Athlete ───────────────────────────────────────────────────────────────────
    // agTextColumnFilter → contains / starts-with / ends-with / regex
    // cellClassRules → conditional CSS classes on the cell element
    {
      headerName: 'Athlete',
      field: 'athlete',
      filter: 'agTextColumnFilter',
      pinned: 'left',
      minWidth: 160,
      cellClassRules: {
        'text-bold': (p) => (p.value?.length ?? 0) > 20,
      },
    },

    // ── Age ───────────────────────────────────────────────────────────────────────
    // valueFormatter → display-only transform; raw value unchanged for sort/filter
    {
      headerName: 'Age',
      field: 'age',
      filter: 'agNumberColumnFilter',
      width: 90,
      valueFormatter: (p: ValueFormatterParams) =>
        p.value != null ? `${p.value} yrs` : '—',
    },

    // ── Country ───────────────────────────────────────────────────────────────────
    // agSetColumnFilter → checkbox list of all unique values; great for enums
    {
      headerName: 'Country',
      field: 'country',
      filter: 'agSetColumnFilter',
      minWidth: 130,
    },

    // ── Year ──────────────────────────────────────────────────────────────────────
    {
      headerName: 'Year',
      field: 'year',
      filter: 'agNumberColumnFilter',
      width: 90,
    },

    // ── Sport ─────────────────────────────────────────────────────────────────────
    {
      headerName: 'Sport',
      field: 'sport',
      filter: 'agSetColumnFilter',
      minWidth: 130,
    },

    // ─── Column Group: Medals ─────────────────────────────────────────────────────
    // ColGroupDef renders a spanning header above children
    // marryChildren: prevents children from being dragged out of the group
    {
      headerName: 'Medals',
      groupId: 'medals',
      marryChildren: true,
      children: [
        {
          headerName: '🥇 Gold',
          field: 'gold',
          filter: 'agNumberColumnFilter',
          width: 100,
          // cellRenderer → custom HTML per cell;
          //  avoid heavy renderers on 10k+ rows
          cellRenderer: (p: ICellRendererParams) =>
            p.value > 0
              ? `<span style="font-weight:700;color:#b8860b">
              ${p.value}</span>`
              : `<span style="color:#aaa">0</span>`,
        },
        {
          headerName: '🥈 Silver',
          field: 'silver',
          filter: 'agNumberColumnFilter',
          width: 100,
          cellRenderer: (p: ICellRendererParams) =>
            p.value > 0
              ? `<span style="font-weight:700;color:#607080">${p.value}</span>`
              : `<span style="color:#aaa">0</span>`,
        },
        {
          headerName: '🥉 Bronze',
          field: 'bronze',
          filter: 'agNumberColumnFilter',
          width: 100,
          cellRenderer: (p: ICellRendererParams) =>
            p.value > 0
              ? `<span style="font-weight:700;color:#a0522d">${p.value}</span>`
              : `<span style="color:#aaa">0</span>`,
        },
        {
          // valueGetter → derived column; no `field` needed
          // This is the RIGHT way to display computed values
          headerName: 'Total',
          valueGetter: (p: ValueGetterParams) =>
            (p.data.gold ?? 0) + (p.data.silver ?? 0) + (p.data.bronze ?? 0),
          filter: 'agNumberColumnFilter',
          width: 90,
        },
      ],
    },

    // ── Salary — editable, formatted, conditional class ──────────────────────────
    // editable: true → double-click to edit inline
    // valueFormatter runs AFTER edit; raw number is preserved for sort/filter
    {
      headerName: 'Salary',
      field: 'salary',
      filter: 'agNumberColumnFilter',
      width: 130,
      editable: true,
      valueFormatter: (p: ValueFormatterParams) =>
        p.value != null
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(p.value)
          : '—',
      cellClassRules: {
        'high-salary': (p) => (p.value ?? 0) > 100_000,
        'low-salary': (p) => (p.value ?? 0) < 50_000,
      },
    },

    // ── Date — hidden; still present in data and CSV export ──────────────────────
    // hide: true → column exists but is not rendered
    { headerName: 'Date', field: 'date', hide: true },
  ];

  // ─── Default ColDef ───────────────────────────────────────────────────────────
  // Applied to every column unless overridden per-ColDef
  public defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    floatingFilter: true,  // ← inline filter row below header; no icon click needed
  };

  // ─── Grid Options ─────────────────────────────────────────────────────────────
  public pagination = true;
  public paginationPageSize = 50;
  public animateRows = true;

  // rowBuffer: rows rendered outside the visible viewport
  // Higher = smoother fast scroll, more DOM nodes. Default = 10.
  public rowBuffer = 20;

  // getRowId: stable key per row.
  // Required for: selection restore, row transactions, deltaRowDataMode
  public getRowId = (p: any): string => String(p.data.id);

  // getRowStyle: inline styles per row — costlier than getRowClass
  public getRowStyle = (p: RowClassParams): RowStyle | undefined =>
    p.node.isSelected() ? { background: '#fffbf0' } : undefined;

  // getRowClass: CSS class strings per row — preferred over getRowStyle for perf
  public getRowClass = (p: RowClassParams): string | undefined =>
    (p.data?.gold ?? 0) > 3 ? 'champion-row' : undefined;

  // ─────────────────────────────────────────────────────────────────────────────

  constructor(private http: HttpClient) { }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    // Debounced localStorage writes — selectAll on 10k rows fires onSelectionChanged
    // once per node. Without debounce you'd JSON.stringify 10k rows 10k times.
    this.selectionSave$
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe(rows => localStorage.setItem('ag-selected', JSON.stringify(rows)));

    this.fetchData();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopAutoRefresh();
  }

  // ─── Auto-refresh ─────────────────────────────────────────────────────────────

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    this.timerId = setInterval(() => {
      if (!this.isFetching) this.fetchData();
    }, this.REFRESH_INTERVAL_MS);
  }

  private stopAutoRefresh(): void {
    if (this.timerId) { clearInterval(this.timerId); this.timerId = undefined; }
  }

  // ─── Data Fetching ────────────────────────────────────────────────────────────

  fetchData(): void {
    if (this.isFetching) return;
    this.isFetching = true;
    this.isLoading = true;
    this.errorMsg = '';
    this.showGridOverlay('loading');

    this.http
      .get<any[]>('https://www.ag-grid.com/example-assets/olympic-winners.json')
      .pipe(
        delay(this.FETCH_DELAY_MS),       // ← 3 000 ms artificial delay
        takeUntil(this.destroy$)          // cancel if component destroyed mid-flight
      )
      .subscribe({
        next: (raw) => {
          this.rowData = raw.map((item, i) => ({
            id: i + 1,
            salary: Math.floor(Math.random() * 200_000) + 30_000,
            ...item,
          }));
          this.isFetching = false;
          this.isLoading = false;
          this.showGridOverlay(this.rowData.length ? 'none' : 'noRows');
        },
        error: (err) => {
          console.error(err);
          this.errorMsg = 'Failed to load data. Check your connection.';
          this.isFetching = false;
          this.isLoading = false;
          this.rowData = [];
          this.showGridOverlay('noRows');
        },
      });
  }

  private showGridOverlay(type: 'loading' | 'noRows' | 'none'): void {
    if (!this.gridApi) return;
    if (type === 'loading') this.gridApi.showLoadingOverlay();
    else if (type === 'noRows') this.gridApi.showNoRowsOverlay();
    else this.gridApi.hideOverlay();
  }

  // ─── Grid Events ─────────────────────────────────────────────────────────────

  onGridReady(params: GridReadyEvent): void {
    this.gridApi = params.api;
    // Show loading overlay immediately if a fetch is already in progress
    if (this.isFetching) this.gridApi.showLoadingOverlay();
    params.api.sizeColumnsToFit();
  }

  // First data render is the correct moment to restore persisted selection —
  // grid is fully initialised and all row nodes exist.
  onFirstDataRendered(_e: FirstDataRenderedEvent): void {
    this.restoreSelection();
  }

  onSelectionChanged(): void {
    if (!this.gridApi) return;
    this.selectedRows = this.gridApi.getSelectedRows();
    this.selectedCount = this.selectedRows.length;
    this.totalMedals = this.selectedRows.reduce(
      (s, r) => s + (r.gold ?? 0) + (r.silver ?? 0) + (r.bronze ?? 0), 0
    );
    this.totalSalary = this.selectedRows.reduce((s, r) => s + (r.salary ?? 0), 0);
    this.selectionSave$.next(this.selectedRows); // debounced write
  }


  // ─── Selection Helpers ────────────────────────────────────────────────────────

  private restoreSelection(): void {
    if (!this.gridApi) return;
    const saved: OlympicRow[] = JSON.parse(localStorage.getItem('ag-selected') || '[]');
    if (!saved.length) return;

    const ids = new Set(saved.map(r => String(r.id)));
    // forEachNode iterates ALL nodes including filtered-out ones
    // Use forEachNodeAfterFilter for visible rows only
    // this.gridApi.forEachNode((node: IRowNode) => {
    this.gridApi.forEachNodeAfterFilter((node: IRowNode) => {
      if (node.data && ids.has(String(node.data.id))) {
        node.setSelected(true, false); // (selected, clearOtherSelections)
      }
    });
    this.onSelectionChanged();
  }

  selectAll(): void { this.gridApi?.selectAll(); }
  deselectAll(): void { this.gridApi?.deselectAll(); }

  deleteSelected(): void {
    if (!this.gridApi || !this.selectedRows.length) return;
    // applyTransaction: efficient partial update — no full re-render
    // Requires getRowId to be defined
    this.gridApi.applyTransaction({ remove: this.selectedRows });
    this.selectedRows = [];
    this.selectedCount = 0;
    this.totalMedals = 0;
    this.totalSalary = 0;
    localStorage.removeItem('ag-selected');
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  exportCsv(): void {
    this.gridApi?.exportDataAsCsv({
      fileName: 'olympic-data.csv',
      onlySelected: this.selectedRows.length > 0, // export selection if any
    });
  }

  // ─── Column State ─────────────────────────────────────────────────────────────
  // Persist column order, width, visibility, pinned state, sort state

  saveColumnState(): void {
    if (!this.gridApi) return;
    localStorage.setItem('ag-cols', JSON.stringify(this.gridApi.getColumnState()));
  }

  restoreColumnState(): void {
    if (!this.gridApi) return;
    const saved = localStorage.getItem('ag-cols');
    if (saved) {
      this.gridApi.applyColumnState({
        state: JSON.parse(saved),
        applyOrder: true
      });
    }
  }

  // ─── Row Transactions ─────────────────────────────────────────────────────────
  // Add / update / remove specific rows without replacing entire rowData array.
  // Much more efficient than full rebind for live data scenarios.

  addRow(row: OlympicRow): void {
    this.gridApi?.applyTransaction({
      add: [row], addIndex: 0
    });
  }


  add_popup = false;

  openAddRowDialog(): void {
    this.add_popup = true;
  }

  closeAddRowDialog(): void {
    this.add_popup = false;
  }

  submitAddRow(f: {
    athlete: string;
    country: string;
    year: string;
    sport: string;
    gold: string;
    silver: string;
    bronze: string;
    salary: string;
  }): void {
    const newRow: OlympicRow = {
      id: Date.now(),           // simple unique id
      athlete: f.athlete,
      country: f.country,
      year: +f.year,
      sport: f.sport,
      gold: +f.gold,
      silver: +f.silver,
      bronze: +f.bronze,
      total: +f.gold + +f.silver + +f.bronze,  // computed, not from input
      salary: +f.salary,
      age: 0,
      date: '',
    };

    this.gridApi?.applyTransaction({ add: [newRow], addIndex: 0 });
    this.add_popup = false;
  }

  // ─── Quick Filter ─────────────────────────────────────────────────────────────
  // Bound via [quickFilterText] on the grid — AG Grid searches all column values
  onQuickFilterChange(val: string): void { this.quickFilter = val; }

  // ─── Format Helpers (template) ───────────────────────────────────────────────
  formatCurrency(v: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
  }
}
