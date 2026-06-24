import * as React from 'react';
import { BrandingPreview } from 'medsaas-web';

export const GreenDefault = () => (
  <div style={{ maxWidth: 360 }}>
    <BrandingPreview
      companyName="ChemBench"
      palette={{ primary: '#4caf50', accent: '#66bb6a', light: '#e8f5e9', dark: '#1b5e20' }}
    />
  </div>
);

export const PurpleBrand = () => (
  <div style={{ maxWidth: 360 }}>
    <BrandingPreview
      companyName="Outwize Inc"
      palette={{ primary: '#7b1fa2', accent: '#ab47bc', light: '#f3e5f5', dark: '#4a148c' }}
    />
  </div>
);

export const WithLogo = () => (
  <div style={{ maxWidth: 360 }}>
    <BrandingPreview
      companyName="Acme Bio"
      logoSrc={
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='40'><rect width='160' height='40' rx='6' fill='#0288d1'/><text x='80' y='26' font-size='18' fill='white' text-anchor='middle' font-family='sans-serif' font-weight='bold'>ACME BIO</text></svg>"
        )
      }
      palette={{ primary: '#0288d1', accent: '#26c6da', light: '#e1f5fe', dark: '#01579b' }}
    />
  </div>
);
