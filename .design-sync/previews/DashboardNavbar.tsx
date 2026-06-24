import * as React from 'react';
import { DashboardNavbar } from 'medsaas-web';

// DashboardNavbar reads router + controller + theme context (supplied by the
// preview provider). It fires background auth/network calls that no-op offline;
// the breadcrumb + search + action chrome still renders.
export const Default = () => <DashboardNavbar />;
