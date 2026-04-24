import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { AgGridModule } from 'ag-grid-angular';
import { HttpClientModule } from '@angular/common/http';
import { AppComponent } from './app.component';
import 'ag-grid-enterprise'

import { FullAggridComponent } from './FullAggrid/FullAggrid.component';
import { Table2Component } from './Table2Component/Table2.component';
import { Table3Component } from './Table3/Table3.component';
import { appRoutes } from './app.routes';

@NgModule({
  declarations: [
    AppComponent,
    FullAggridComponent
    , Table2Component, Table3Component
  ],
  imports: [
    BrowserModule,
    RouterModule.forRoot(appRoutes),
    ReactiveFormsModule,
    FormsModule,
    HttpClientModule,
    AgGridModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
