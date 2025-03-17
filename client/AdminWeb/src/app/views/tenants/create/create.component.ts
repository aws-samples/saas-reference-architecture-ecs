import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators, ValidatorFn, ValidationErrors, AbstractControl } from '@angular/forms';
import { Router } from '@angular/router';
import { TenantsService } from '../tenants.service';
import { v4 as guid } from 'uuid';

@Component({
  selector: 'app-create',
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.scss'],
})
export class CreateComponent implements OnInit {
  submitting = false;
  tenantForm = new FormGroup({
    tenantName: new FormControl('', [Validators.required, this.lowercaseAndNumberValidator() ]),
    email: new FormControl('', [Validators.email, Validators.required]),
    tier: new FormControl('', [Validators.required]),
    prices: new FormControl<any[]>([]) 
  });
  constructor(
    private tenantSvc: TenantsService,
    private router: Router,
  ) {}

  ngOnInit(): void {}

  submit() {
    this.submitting = true;

    const tenant = {
      tenantId: guid(),
      tenantData: {
        ...this.tenantForm.value,
        prices: this.tenantForm.value.prices || [],
      },
      tenantRegistrationData: {
        registrationStatus: "In progress"
      }
    };

    // const tenant = {
    //   ...this.tenantForm.value,
    //   tenantId: guid(),
    //   tenantStatus: 'In progress',
    // };

    this.tenantSvc.post(tenant).subscribe({
      next: () => {
        this.submitting = false;
        this.router.navigate(['tenants']);
      },
      error: (err: any) => {
        console.error(err);
        this.submitting = false;
      },
    });
  }

  lowercaseAndNumberValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      if (value && !/^[a-z][a-z0-9-]*$/.test(value)) {
        return { lowercaseAndNumbers: 'Must start with a lowercase, and only lowercase, numbers, and hyphen' };
      }
      return null;
    }
  }

  public get tenantName() {
    return this.tenantForm.get('tenantName');
  }

  public get email() {
    return this.tenantForm.get('email');
  }

  public get tier() {
    return this.tenantForm.get('tier');
  }
}
