import { Routes } from '@angular/router';

import { FullAggridComponent } from './FullAggrid/FullAggrid.component';

export const appRoutes: Routes = [
  { path: '', pathMatch: 'full', component: FullAggridComponent },
  { path: 'full-aggrid', component: FullAggridComponent },
  { path: '**', redirectTo: '' }
];
