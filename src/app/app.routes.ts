import { Routes } from '@angular/router';

import { FullAggridComponent } from './FullAggrid/FullAggrid.component';
import { Table2Component } from './Table2Component/Table2.component';
import { Table3Component } from './Table3/Table3.component';

export const appRoutes: Routes = [
  { path: '', pathMatch: 'full', component: FullAggridComponent },
  { path: 'full-aggrid', component: FullAggridComponent },
  {
    path: 'table2', component: Table2Component,

  },
  {
    path: 'table3', component: Table3Component,

  },
  { path: '**', redirectTo: '' }
];
