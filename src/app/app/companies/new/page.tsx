import { CompanyForm } from "@/components/company-form";
import { PageHeader } from "@/components/ui";
import { requireCompany } from "@/lib/auth";
import { env } from "@/lib/env";
import { addCompany } from "../../actions";

export default async function NewCompany() {
  const { companies } = await requireCompany();
  return (
    <>
      <PageHeader title="Add a company" subtitle={`You run ${companies.length} ${companies.length === 1 ? "company" : "companies"}. Each has its own wallets, payees, rules and approvals.`} />
      <div className="max-w-[560px]">
        <CompanyForm action={addCompany} mock={env.mode === "mock"} first={false} />
      </div>
    </>
  );
}
