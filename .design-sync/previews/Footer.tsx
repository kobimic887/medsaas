import * as React from 'react';
import { Footer } from 'medsaas-web';

export const Default = () => (
  <div style={{ position: 'relative', height: 60 }}>
    <Footer />
  </div>
);

export const CustomLinks = () => (
  <div style={{ position: 'relative', height: 60 }}>
    <Footer
      brandName="ChemBench"
      brandLink="https://chembench.io"
      routes={[
        { name: 'ChemBench', path: 'https://chembench.io' },
        { name: 'Docs', path: 'https://chembench.io/docs' },
        { name: 'Pricing', path: 'https://chembench.io/pricing' },
        { name: 'Contact', path: 'https://chembench.io/contact' },
      ]}
    />
  </div>
);
