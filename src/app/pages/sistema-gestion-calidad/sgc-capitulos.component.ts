import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-sgc-capitulos',
  template: '',
  styleUrls: ['./sistema-gestion-calidad.component.scss']
})
export class SgcCapitulosComponent implements OnInit {
  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    const slugParam = (this.route.snapshot.paramMap.get('capitulo') || '').toLowerCase();
    const slugQuery = (this.route.snapshot.queryParamMap.get('cap') || '').toLowerCase();
    const cap = slugParam || slugQuery || null;

    void this.router.navigate(['/sistema-gestion-calidad'], {
      queryParams: cap ? { cap } : {},
      fragment: 'sgc-capitulos-panel',
      replaceUrl: true
    });
  }
}
