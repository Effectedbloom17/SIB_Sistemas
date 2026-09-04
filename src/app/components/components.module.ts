import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SidebarComponent } from './sidebar/sidebar.component';
import { NavbarComponent } from './navbar/navbar.component';
import { FooterComponent } from './footer/footer.component';
import { DocumentPreviewComponent } from './document-preview/document-preview.component';
import { PdfCanvasViewerComponent } from './pdf-canvas-viewer/pdf-canvas-viewer.component';
import { SafePipe } from '../pipes/safe.pipe';
import { FechaCursoPipe } from '../pipes/fecha-curso.pipe';
import { RouterModule } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { HttpClientModule } from '@angular/common/http';

@NgModule({
  imports: [
    HttpClientModule,
    CommonModule,
    FormsModule,
    RouterModule,
    NgbModule
  ],
  declarations: [
    FooterComponent,
    NavbarComponent,
    SidebarComponent,
    DocumentPreviewComponent,
    PdfCanvasViewerComponent,
    SafePipe,
    FechaCursoPipe
  ],
  exports: [
    HttpClientModule,
    FooterComponent,
    NavbarComponent,
    SidebarComponent,
    DocumentPreviewComponent,
    PdfCanvasViewerComponent,
    SafePipe,
    FechaCursoPipe
  ]
})
export class ComponentsModule { }
