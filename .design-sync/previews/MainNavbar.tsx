import * as React from 'react';
import { MainNavbar } from 'medsaas-web';

// MainNavbar reads router + auth + theme context (all supplied by the preview
// provider). Logged-out state renders the ChemBench brand, BETA badge, theme
// toggle and auth actions.
export const Default = () => <MainNavbar />;
