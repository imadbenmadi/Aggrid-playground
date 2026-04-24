import { Component, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  ColDef,
  ColGroupDef,
  GridApi,
  GridReadyEvent,
  ValueGetterParams,
  ValueFormatterParams,
  ICellRendererParams,
} from 'ag-grid-community';
import { Subject } from 'rxjs';
import { takeUntil, delay } from 'rxjs/operators';

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

@Component({
  selector: 'app-aws-grid',
  template: `
    <div style="height: 100vh; display: flex; flex-direction: column; padding: 10px;">
      <div style="margin-bottom: 10px;">
        <button (click)="onFlashOne()">Flash First Row</button>
        <button (click)="onRefreshView()">Force Refresh View</button>
        <span *ngIf="isLoading" style="margin-left: 10px; color: blue;">Fetching Data...</span>
      </div>
      <ag-grid-angular
        style="width: 100%; height: 600px;"
        class="ag-theme-alpine"
        [columnDefs]="columnDefs"
        [rowData]="rowData"
        [getRowId]="getRowId"
        [animateRows]="true"
        (gridReady)="onGridReady($event)">
      </ag-grid-angular>
    </div>
  `
})
export class Table2Component implements OnDestroy {
  private gridApi!: GridApi;
  private destroy$ = new Subject<void>();

  public rowData: OlympicRow[] = [];
  public isLoading = false;
  public isFetching = false;
  private readonly FETCH_DELAY_MS = 3000;

  columnDefs: (ColDef | ColGroupDef)[] = [
    // 1. Grouping by country
    { field: 'country', rowGroup: true, hide: true },

    // 2. Athlete Info - Added safety check for params.data
    {
      headerName: 'Athlete Info',
      valueGetter: (params: ValueGetterParams) =>
        params.data ? `${params.data.athlete} (${params.data.age})` : ''
    },

    {
      headerName: 'Medals',
      children: [
        {
          headerName: '🥇 Gold',
          field: 'gold',
          filter: 'agNumberColumnFilter',
          width: 100,
          cellRenderer: (p: ICellRendererParams) =>
            p.value > 0 ? `<span style="font-weight:700;color:#b8860b">${p.value}</span>` : `<span style="color:#aaa">0</span>`,
        },
        {
          headerName: '🥈 Silver',
          field: 'silver',
          filter: 'agNumberColumnFilter',
          width: 100,
          cellRenderer: (p: ICellRendererParams) =>
            p.value > 0 ? `<span style="font-weight:700;color:#607080">${p.value}</span>` : `<span style="color:#aaa">0</span>`,
        },
        {
          headerName: '🥉 Bronze',
          field: 'bronze',
          filter: 'agNumberColumnFilter',
          width: 100,
          cellRenderer: (p: ICellRendererParams) =>
            p.value > 0 ? `<span style="font-weight:700;color:#a0522d">${p.value}</span>` : `<span style="color:#aaa">0</span>`,
        },
        // 3. Total Calculation - Added safety check for params.data
        {
          headerName: 'Total',
          valueGetter: (p: ValueGetterParams) => {
            if (!p.data) return 0; // Crucial for group rows
            return (p.data.gold ?? 0) + (p.data.silver ?? 0) + (p.data.bronze ?? 0);
          },
          filter: 'agNumberColumnFilter',
          width: 90,
        },
      ],
    },

    {
      field: 'salary',
      headerName: 'Salary',
      enableCellChangeFlash: true,
      valueFormatter: (params: ValueFormatterParams) =>
        params.value != null ? `$${params.value.toLocaleString()}` : '—'
    },

    {
      headerName: 'Action',
      cellRenderer: (params: ICellRendererParams) => {
        if (params.node?.group) {
          return `<button style="background:#555;color:white;border:none;cursor:pointer;">Delete Group</button>`;
        }
        return `<button style="background:red;color:white;border:none;cursor:pointer;">Delete Row</button>`;
      }
    }
  ];

  constructor(private http: HttpClient) {}

  onGridReady(params: GridReadyEvent) {
    this.gridApi = params.api;

    // Fix: Delaying the UI updates to avoid "middle of drawing rows" error
    setTimeout(() => {
      this.fetchData();
      this.gridApi.sizeColumnsToFit();
    }, 0);
  }

  fetchData(): void {
    if (this.isFetching) return;
    this.isFetching = true;
    this.isLoading = true;
    this.gridApi?.showLoadingOverlay();

    this.http
      .get<any[]>('https://www.ag-grid.com/example-assets/olympic-winners.json')
      .pipe(
        delay(this.FETCH_DELAY_MS),
        takeUntil(this.destroy$)
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
          this.gridApi?.hideOverlay();
          if (this.rowData.length === 0) this.gridApi?.showNoRowsOverlay();
        },
        error: (err) => {
          console.error(err);
          this.isFetching = false;
          this.isLoading = false;
          this.gridApi?.showNoRowsOverlay();
        },
      });
  }

  onRefreshView() {
    this.gridApi?.refreshCells({ force: true });
  }

  onFlashOne() {
    const rowNode = this.gridApi?.getDisplayedRowAtIndex(0);
    if (rowNode) {
      this.gridApi?.flashCells({ rowNodes: [rowNode], columns: ['salary'] });
    }
  }

  getRowId = (params: any) => params.data.id;

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
