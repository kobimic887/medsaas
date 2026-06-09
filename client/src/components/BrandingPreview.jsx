import React from "react";
import PropTypes from "prop-types";
import {
  Card,
  CardBody,
  CardHeader,
  Typography,
} from "@material-tailwind/react";

const paletteFields = [
  ["primary", "Primary"],
  ["accent", "Accent"],
  ["light", "Light"],
  ["dark", "Dark"],
];

export function BrandingPreview({ companyName, logoSrc, palette }) {
  const [logoFailed, setLogoFailed] = React.useState(false);

  React.useEffect(() => {
    setLogoFailed(false);
  }, [logoSrc]);

  const showLogo = Boolean(logoSrc) && !logoFailed;

  return (
    <Card className="border border-blue-gray-100 shadow-sm">
      <CardHeader floated={false} shadow={false} className="rounded-none">
        <Typography variant="h5" color="blue-gray">
          Preview
        </Typography>
      </CardHeader>
      <CardBody>
        <div
          className="overflow-hidden rounded-xl border border-blue-gray-200"
          style={{ backgroundColor: palette.light }}
        >
          <div className="bg-white p-5">
            <div className="flex min-h-[76px] flex-col items-center justify-center gap-2 text-center">
              {showLogo ? (
                <img
                  src={logoSrc}
                  alt={`${companyName} logo`}
                  className="h-12 w-auto max-w-[160px] object-contain"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <Typography variant="h6" color="blue-gray">
                  {companyName}
                </Typography>
              )}
              {showLogo && (
                <Typography variant="small" color="blue-gray" className="font-medium">
                  {companyName}
                </Typography>
              )}
            </div>

            <div className="mt-5 space-y-3">
              <div
                className="rounded-lg px-4 py-3 text-sm font-medium text-white"
                style={{ backgroundColor: palette.primary }}
              >
                Active navigation
              </div>
              <button
                type="button"
                className="min-h-[40px] rounded-lg px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: palette.accent }}
                tabIndex={-1}
              >
                Accent action
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-blue-gray-200 p-4">
            {paletteFields.map(([key, label]) => (
              <div key={key} className="rounded-lg bg-white p-3">
                <div
                  className="h-10 w-full rounded-lg border border-blue-gray-200"
                  style={{ backgroundColor: palette[key] }}
                  aria-label={`${label} color ${palette[key]}`}
                />
                <Typography variant="small" color="blue-gray" className="mt-2 font-medium">
                  {label}
                </Typography>
                <Typography variant="small" color="gray" className="font-mono text-xs">
                  {palette[key]}
                </Typography>
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

BrandingPreview.propTypes = {
  companyName: PropTypes.string.isRequired,
  logoSrc: PropTypes.string,
  palette: PropTypes.shape({
    primary: PropTypes.string.isRequired,
    accent: PropTypes.string.isRequired,
    light: PropTypes.string.isRequired,
    dark: PropTypes.string.isRequired,
  }).isRequired,
};

BrandingPreview.defaultProps = {
  logoSrc: null,
};

export default BrandingPreview;
