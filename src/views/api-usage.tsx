import { t } from "@/i18n";
import { ApiCodeBlock } from "./api-code-block";

const example = JSON.stringify(
  {
    ip: "203.0.113.10",
    source: "Net.Coffee",
    checked_at: "2026-09-11T08:00:00.000Z",
    score: 85,
    status: "good",
    country: "Singapore",
    region: null,
    city: "Singapore",
    isp: "Example ISP",
    asn: 64496,
    flags: {
      residential: true,
      datacenter: false,
      mobile: false,
      vpn: false,
      proxy: false,
      tor: false,
      crawler: false,
      abuser: false,
    },
  },
  null,
  2,
);

export default function ApiUsagePage() {
  const endpoint = `${window.location.origin}/api/ip/health`;
  const command = `curl -fsS '${endpoint}'`;
  return (
    <article className="api-usage mx-auto max-w-4xl space-y-6 py-4 sm:py-8">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {t("apiUsage.tsx.myIpInformationApi")}
      </h1>
      <p className="leading-7 text-muted-foreground">
        {t("apiUsage.tsx.oneIpProvidesPublicApiRequestEgressIp")}
      </p>
      <p className="break-words leading-7">
        {t("apiUsage.tsx.endpoint")}{" "}
        <a
          className="text-primary underline underline-offset-4"
          href={endpoint}
          target="_blank"
          rel="noreferrer"
        >
          {endpoint}
        </a>
      </p>
      <ApiCodeBlock code={command} language="bash" />
      <a
        className="inline-block text-sm text-primary hover:underline"
        href="https://github.com/fengderenzhui-lab/one-ip"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("navigation.fullGuide")} ↗
      </a>
      <p className="text-sm leading-6 text-muted-foreground">
        {t("apiUsage.tsx.addIp1111QueryPublic")}
      </p>
      <section className="space-y-4 pt-6">
        <h2 className="text-2xl font-semibold">
          {t("apiUsage.tsx.exampleResponse")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("apiUsage.tsx.illustrativeDataNotALiveQueryResult")}
        </p>
        <ApiCodeBlock code={example} language="json" />
        <p className="text-sm leading-6 text-muted-foreground">
          {t("apiUsage.tsx.higherReputationScoresBetterUnknownFieldsNullApi")}
        </p>
      </section>
    </article>
  );
}
