import * as React from 'react';
import { Navbar } from 'medsaas-web';
import { Button } from '@material-tailwind/react';

const Icon = (d: string) => (props: any) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d={d} />
  </svg>
);

const routes = [
  { name: 'home', path: '/', icon: Icon('M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z') },
  { name: 'services', path: '/services', icon: Icon('M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z') },
  { name: 'about us', path: '/about', icon: Icon('M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2zm0-8h-2V7h2z') },
];

export const Default = () => (
  <Navbar
    brandName="ChemBench"
    routes={routes}
    action={
      <Button variant="gradient" size="sm">
        sign up
      </Button>
    }
  />
);
