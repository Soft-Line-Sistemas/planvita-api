import puppeteer from "puppeteer";

const URL = "https://app.campodobosque.com.br/cliente/cadastro";

const BASE_TITULAR = {
  nome: "Cliente Teste Producao",
  cpf: "52998224725",
  dataNascimento: "1991-07-16",
  sexo: "Masculino",
  naturalidade: "Salvador",
  situacaoConjugal: "Solteiro(a)",
  profissao: "Analista",
  telefone: "71999999999",
  whatsapp: "71999999999",
};

const BASE_RESPONSAVEL = {
  nome: "Responsavel Teste",
  cpf: "11144477735",
  dataNascimento: "1985-01-01",
  parentesco: "Cônjuge",
  sexo: "Feminino",
  naturalidade: "Salvador",
  situacaoConjugal: "Casado(a)",
  profissao: "Professora",
  telefone: "71988887777",
  whatsapp: "71988887777",
};

const ADDRESS = {
  cep: "40000000",
  uf: "BA",
  cidade: "Salvador",
  bairro: "Centro",
  logradouro: "Rua A",
  numero: "10",
  complemento: "Casa",
  referencia: "Praca",
};

const ALL_RELATIONSHIPS = [
  "Cônjuge",
  "Companheiro(a)",
  "Filho(a)",
  "Enteado(a)",
  "Pai",
  "Mãe",
  "Padrasto",
  "Madrasta",
  "Sogro(a)",
  "Irmão(ã)",
  "Avô/Avó",
  "Neto(a)",
  "Tio(a)",
  "Outro",
];

const RELATIONSHIP_SCENARIOS = [
  ...ALL_RELATIONSHIPS.map((relationship) => ({
    label: `${relationship} - 25 anos`,
    relationship,
    birthDate: "2001-07-16",
  })),
  {
    label: "Outro - 60 anos",
    relationship: "Outro",
    birthDate: "1966-07-16",
  },
  {
    label: "Outro - 61 anos",
    relationship: "Outro",
    birthDate: "1965-07-16",
  },
  {
    label: "Outro - 71 anos",
    relationship: "Outro",
    birthDate: "1955-07-16",
  },
  {
    label: "Outro - 81 anos",
    relationship: "Outro",
    birthDate: "1945-07-16",
  },
];

const PLAN_SUGGESTION_SCENARIOS = [
  { label: "Titular 35 anos, sem dependentes" },
  { label: "Titular 35 anos, filho de 10 anos", relationship: "Filho(a)", birthDate: "2016-07-16" },
  { label: "Titular 35 anos, irmão de 10 anos", relationship: "Irmão(ã)", birthDate: "2016-07-16" },
  { label: "Titular 35 anos, outro de 25 anos", relationship: "Outro", birthDate: "2001-07-16" },
  { label: "Titular 35 anos, outro de 60 anos", relationship: "Outro", birthDate: "1966-07-16" },
  { label: "Titular 35 anos, outro de 61 anos", relationship: "Outro", birthDate: "1965-07-16" },
  { label: "Titular 35 anos, outro de 81 anos", relationship: "Outro", birthDate: "1945-07-16" },
  { label: "Titular 56 anos, sem dependentes", titularBirthDate: "1970-07-16" },
];

const COMPREHENSIVE_SCENARIOS = [
  ...ALL_RELATIONSHIPS.filter((relationship) => relationship !== "Outro").map(
    (relationship) => ({
      label: `Titular 35 anos, ${relationship} de 25 anos`,
      relationship,
      birthDate: "2001-07-16",
    }),
  ),
  { label: "Titular 35 anos, Outro de 25 anos", relationship: "Outro", birthDate: "2001-07-16" },
  { label: "Titular 35 anos, Outro de 60 anos", relationship: "Outro", birthDate: "1966-07-16" },
  { label: "Titular 35 anos, Outro de 61 anos", relationship: "Outro", birthDate: "1965-07-16" },
  { label: "Titular 35 anos, Outro de 71 anos", relationship: "Outro", birthDate: "1955-07-16" },
  { label: "Titular 35 anos, Outro de 81 anos", relationship: "Outro", birthDate: "1945-07-16" },
  { label: "Titular 35 anos, Outro de 86 anos", relationship: "Outro", birthDate: "1940-07-16" },
  { label: "Titular de 17 anos, sem dependentes", titularBirthDate: "2009-07-16" },
  { label: "Titular de 35 anos, sem dependentes", titularBirthDate: "1991-07-16" },
  { label: "Titular de 56 anos, sem dependentes", titularBirthDate: "1970-07-16" },
  { label: "Titular de 61 anos, sem dependentes", titularBirthDate: "1965-07-16" },
  { label: "Titular de 66 anos, sem dependentes", titularBirthDate: "1960-07-16" },
];

const scenarios =
  process.env.TEST_MODE === "comprehensive"
    ? COMPREHENSIVE_SCENARIOS
    : process.env.TEST_MODE === "plan_suggestions"
      ? PLAN_SUGGESTION_SCENARIOS
      : RELATIONSHIP_SCENARIOS;

function expectedAdditional(relationship, age) {
  if (relationship !== "Outro") return null;
  if (age <= 60) return "R$ 9,90";
  if (age <= 70) return "R$ 19,90";
  if (age <= 80) return "R$ 29,90";
  return "R$ 49,90";
}

function expectedPlanFamily(age, relationship) {
  const socialEligible = new Set([
    "Cônjuge",
    "Companheiro(a)",
    "Filho(a)",
    "Enteado(a)",
    "Neto(a)",
  ]);

  if (age <= 55 && socialEligible.has(relationship)) {
    return ["PLANO SOCIAL", "PLANO ESSENCIAL"];
  }
  if (age <= 60) return ["PLANO ESSENCIAL"];
  if (age <= 70) return ["PLANO PLUS"];
  if (age <= 80) return ["PLANO FAMÍLIA"];
  if (age <= 85) return ["PLANO SÊNIOR"];
  return ["PLANO PREMIUM"];
}

async function visibleHandles(page, selector) {
  const handles = await page.$$(selector);
  const visible = [];
  for (const handle of handles) {
    const isVisible = await handle.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    if (isVisible) visible.push(handle);
  }
  return visible;
}

async function findVisibleInputByPlaceholderContains(page, fragment, index = 0) {
  const handles = await visibleHandles(page, "input");
  const normalizedFragment = fragment.toLowerCase();
  const matching = [];
  for (const handle of handles) {
    const placeholder = await handle.evaluate(
      (el) => el.getAttribute("placeholder") ?? "",
    );
    if (placeholder.toLowerCase().includes(normalizedFragment)) {
      matching.push(handle);
    }
  }
  const handle = matching[index];
  if (!handle) {
    throw new Error(
      `Input placeholder contendo "${fragment}" index=${index} não encontrado`,
    );
  }
  return handle;
}

async function fillVisibleByPlaceholder(page, fragment, value, index = 0) {
  const handle = await findVisibleInputByPlaceholderContains(
    page,
    fragment,
    index,
  );
  await handle.click({ clickCount: 3 });
  await handle.type(value);
}

async function fillVisibleByAnyPlaceholder(page, fragments, value, index = 0) {
  let lastError = null;
  for (const fragment of fragments) {
    try {
      await fillVisibleByPlaceholder(page, fragment, value, index);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Nenhum placeholder encontrado: ${fragments.join(", ")}`);
}

async function waitForVisiblePlaceholder(page, fragments, index = 0) {
  let lastError = null;
  for (const fragment of fragments) {
    try {
      await findVisibleInputByPlaceholderContains(page, fragment, index);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Nenhum placeholder visível: ${fragments.join(", ")}`);
}

async function fillVisibleTextareasOrInputsByType(page, selector, value, index = 0) {
  await page.waitForSelector(selector);
  const inputs = await visibleHandles(page, selector);
  const handle = inputs[index];
  if (!handle) {
    throw new Error(`Selector ${selector} index=${index} não encontrado`);
  }
  await handle.click({ clickCount: 3 });
  await handle.type(value);
}

async function setVisibleDateInput(page, value, index = 0) {
  const inputs = await visibleHandles(page, 'input[type="date"]');
  const handle = inputs[index];
  if (!handle) {
    throw new Error(`Input date index=${index} não encontrado`);
  }
  await handle.evaluate((el, nextValue) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(el, nextValue);
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }, value);
}

async function selectVisible(page, value, index = 0) {
  await page.waitForSelector("select");
  const selects = await visibleHandles(page, "select");
  const handle = selects[index];
  if (!handle) {
    throw new Error(`Select index=${index} não encontrado`);
  }
  const selected = await handle.select(value);
  if (selected.length > 0) return;

  const optionValue = await handle.evaluate((el, label) => {
    const normalize = (value) =>
      String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .trim();
    const target = normalize(label);
    const option = Array.from(el.options).find(
      (item) =>
        normalize(item.value) === target || normalize(item.textContent) === target,
    );
    return option?.value ?? null;
  }, value);
  if (!optionValue) {
    throw new Error(`Opção "${value}" não encontrada no select ${index}`);
  }
  await handle.select(optionValue);
}

async function clickButtonByText(page, expectedText) {
  const buttons = await visibleHandles(page, "button");
  for (const button of buttons) {
    const text = await button.evaluate((el) => el.textContent?.trim() ?? "");
    if (text === expectedText) {
      await button.click();
      return;
    }
  }
  throw new Error(`Botão "${expectedText}" não encontrado`);
}

async function clickButtonContainingText(page, fragment) {
  const buttons = await visibleHandles(page, "button");
  for (const button of buttons) {
    const text = await button.evaluate((el) => el.textContent?.trim() ?? "");
    if (text.includes(fragment)) {
      await button.click();
      return;
    }
  }
  throw new Error(`Botão contendo "${fragment}" não encontrado`);
}

async function waitForText(page, text) {
  await page.waitForFunction(
    (target) => document.body.innerText.includes(target),
    {},
    text,
  );
}

async function waitForAnyText(page, texts) {
  await page.waitForFunction(
    (targets) => targets.some((target) => document.body.innerText.includes(target)),
    {},
    texts,
  );
}

async function fillTitular(page, email, titular = BASE_TITULAR) {
  await fillVisibleByPlaceholder(page, "nome completo", titular.nome);
  await fillVisibleByPlaceholder(page, "000.000.000-00", titular.cpf, 0);
  await setVisibleDateInput(page, titular.dataNascimento, 0);
  await selectVisible(page, titular.sexo, 0);
  await fillVisibleByPlaceholder(page, "cidade onde nasceu", titular.naturalidade);
  await selectVisible(page, titular.situacaoConjugal, 1);
  await fillVisibleByPlaceholder(page, "sua profissão", titular.profissao, 0);
  await fillVisibleByPlaceholder(page, "00000-0000", titular.telefone, 0);
  await fillVisibleByPlaceholder(page, "00000-0000", titular.whatsapp, 1);
  await fillVisibleByPlaceholder(page, "email", email, 0);
  await clickButtonByText(page, "Continuar");
  try {
    await waitForText(page, "Endereço");
  } catch {
    const diagnostic = await page.evaluate(() => ({
      errors: Array.from(document.querySelectorAll(".error, [role='alert']"))
        .map((el) => el.textContent?.trim() ?? "")
        .filter(Boolean),
      fields: Array.from(document.querySelectorAll("input, select"))
        .filter((el) => {
          const style = window.getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .map((el) => ({
          placeholder: el.getAttribute("placeholder"),
          value: el.value,
          valid: el.checkValidity(),
          message: el.validationMessage,
        })),
    }));
    throw new Error(`Não avançou da etapa Titular. Diagnóstico: ${JSON.stringify(diagnostic)}`);
  }
}

async function fillAddressStep(page) {
  await fillVisibleByPlaceholder(page, "00000-000", ADDRESS.cep);
  await selectVisible(page, ADDRESS.uf, 0);
  await fillVisibleByPlaceholder(page, "cidade", ADDRESS.cidade);
  await fillVisibleByPlaceholder(page, "bairro", ADDRESS.bairro);
  await fillVisibleByAnyPlaceholder(
    page,
    ["logradouro", "nome da rua", "rua"],
    ADDRESS.logradouro,
  );
  await fillVisibleByPlaceholder(page, "Nº", ADDRESS.numero);
  await fillVisibleByAnyPlaceholder(page, ["opcional", "apto", "complemento"], ADDRESS.complemento);
  await fillVisibleByAnyPlaceholder(page, ["próximo", "ponto de referência"], ADDRESS.referencia);
  await clickButtonByText(page, "Continuar");
}

async function fillResponsavel(page, email) {
  await fillVisibleByPlaceholder(page, "responsável", BASE_RESPONSAVEL.nome);
  await fillVisibleByPlaceholder(page, "000.000.000-00", BASE_RESPONSAVEL.cpf, 0);
  await setVisibleDateInput(page, BASE_RESPONSAVEL.dataNascimento, 0);
  await selectVisible(page, BASE_RESPONSAVEL.parentesco, 0);
  await selectVisible(page, BASE_RESPONSAVEL.sexo, 1);
  await fillVisibleByPlaceholder(page, "cidade", BASE_RESPONSAVEL.naturalidade);
  await selectVisible(page, BASE_RESPONSAVEL.situacaoConjugal, 2);
  await fillVisibleByPlaceholder(page, "profissão", BASE_RESPONSAVEL.profissao, 0);
  await fillVisibleByPlaceholder(page, "00000-0000", BASE_RESPONSAVEL.telefone, 0);
  await fillVisibleByPlaceholder(page, "00000-0000", BASE_RESPONSAVEL.whatsapp, 1);
  await fillVisibleByPlaceholder(page, "email", email, 0);
  await clickButtonByText(page, "Continuar");
}

async function addDependent(page, relationship, birthDate, index) {
  await clickButtonByText(page, "Adicionar");
  await page.waitForSelector('[role="dialog"]');
  const dialog = await page.$('[role="dialog"]');
  const textInputs = await dialog.$$('input:not([type="date"])');
  await textInputs[0].type(`Dependente ${index + 1}`);
  const dateInput = await dialog.$('input[type="date"]');
  await dateInput.evaluate((el, nextValue) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(el, nextValue);
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }, birthDate);
  const select = await dialog.$("select");
  await select.select(relationship);
  await clickButtonByText(page, "Confirmar");
  await page.waitForFunction(() => {
    const hasResumo = document.querySelectorAll(".cm-cad-dep-resumo-card").length > 0;
    const hasDialog = Boolean(document.querySelector('[role="dialog"]'));
    const hasErrors = document.querySelectorAll(".error").length > 0;
    return hasResumo || (hasDialog && hasErrors);
  });
  const dependentState = await page.evaluate((label) => {
    const hasResumo = document.body.innerText.includes(`Parentesco: ${label}`);
    const errorTexts = Array.from(document.querySelectorAll(".error"))
      .map((el) => el.parentElement?.textContent?.trim() ?? el.textContent?.trim() ?? "")
      .filter(Boolean);
    return { hasResumo, errorTexts };
  }, relationship);
  if (!dependentState.hasResumo) {
    throw new Error(
      `Dependente não confirmado para ${relationship}. Erros: ${dependentState.errorTexts.join(" | ") || "não identificados"}`,
    );
  }
  const additional = await page.evaluate((label) => {
    const cards = Array.from(document.querySelectorAll(".cm-cad-dep-resumo-card"));
    const card = cards.find((item) =>
      item.textContent?.includes(`Parentesco: ${label}`),
    );
    return card?.querySelector(".cm-cad-dep-adicional-pill")?.textContent?.trim() ?? null;
  }, relationship);
  await clickButtonByText(page, "Continuar");
  return additional;
}

async function collectPlanStep(page) {
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    const hasPlanCards =
      document.querySelectorAll(".cm-cad-plan-card .cm-cad-plan-name").length > 0;
    return (
      hasPlanCards ||
      text.includes("Planos compatíveis com seu perfil") ||
      text.includes("Nenhum plano compatível está disponível") ||
      text.includes("Nenhum plano disponível no momento.")
    );
  });

  return page.evaluate(() => {
    const planNames = Array.from(document.querySelectorAll(".cm-cad-plan-name"))
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean);
    const selectedPlan =
      document
        .querySelector(".cm-cad-plan-card.selected .cm-cad-plan-name")
        ?.textContent?.trim() ?? null;
    const bodyText = document.body.innerText;
    return {
      planNames,
      selectedPlan,
      hasCompatibleHeader: bodyText.includes("Planos compatíveis com seu perfil"),
      hasNoCompatibleMessage: bodyText.includes(
        "Nenhum plano compatível está disponível para o perfil cadastrado.",
      ),
      hasNoPlanMessage: bodyText.includes("Nenhum plano disponível no momento."),
    };
  });
}

async function goToConfirmation(page) {
  await clickButtonByText(page, "Continuar");
  await page.waitForFunction(
    () => document.querySelectorAll(".cm-cad-service-card").length > 0,
  );
  await clickButtonByText(page, "Continuar");
  await waitForAnyText(page, ["PIX", "Boleto bancário", "Cartão de crédito"]);
  await clickButtonContainingText(page, "PIX");
  await clickButtonByText(page, "Continuar");
  await waitForText(page, "Revise os dados antes de finalizar.");
}

async function collectConfirmation(page, relationship) {
  return page.evaluate((currentRelationship) => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const bodyText = document.body.innerText;
    const findLine = (label) => {
      const line = bodyText
        .split("\n")
        .map((item) => normalize(item))
        .find((item) => item.startsWith(label));
      return line ?? null;
    };

    const planLine = findLine("Plano:");
    const baseLine = findLine("Valor mensal:");
    const additionalLine = findLine("Adicionais:");
    const totalLine = findLine("Total mensal:");

    const cards = Array.from(document.querySelectorAll(".cm-cad-dep-resumo-card"));
    let dependentAdditional = null;
    for (const card of cards) {
      const text = normalize(card.textContent ?? "");
      if (!text.includes(`Parentesco: ${currentRelationship}`)) continue;
      const pill = card.querySelector(".cm-cad-dep-adicional-pill");
      dependentAdditional = pill?.textContent?.trim() ?? null;
      break;
    }

    return {
      planLine,
      baseLine,
      additionalLine,
      totalLine,
      dependentAdditional,
    };
  }, relationship);
}

function parseAge(birthDate) {
  const year = Number(birthDate.slice(0, 4));
  return 2026 - year;
}

async function runScenario(browser, scenario, index) {
  const page = await browser.newPage();
  const planResponses = [];
  let registerRequests = 0;

  page.on("response", async (response) => {
    if (!response.url().includes("/api/v1/plano/sugerir")) return;
    planResponses.push(response.status());
  });

  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/titular")
    ) {
      registerRequests += 1;
    }
  });

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);

  const emailSuffix = `${Date.now()}-${index}`;

  try {
    console.error(`[${scenario.label}] abrindo cadastro`);
    await page.setCacheEnabled(false);
    await page.goto(`${URL}?qa=${emailSuffix}`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    console.error(`[${scenario.label}] preenchendo titular`);
    const titular = {
      ...BASE_TITULAR,
      dataNascimento: scenario.titularBirthDate ?? BASE_TITULAR.dataNascimento,
    };
    await fillTitular(page, `cliente.${emailSuffix}@example.com`, titular);
    console.error(`[${scenario.label}] endereco titular`);
    await waitForVisiblePlaceholder(page, ["00000-000"]);
    await fillAddressStep(page);
    console.error(`[${scenario.label}] responsavel financeiro`);
    await waitForVisiblePlaceholder(page, ["responsável"]);
    await fillResponsavel(page, `responsavel.${emailSuffix}@example.com`);
    console.error(`[${scenario.label}] endereco responsavel`);
    await waitForAnyText(page, ["Usar o mesmo endereço do titular", "Logradouro"]);
    await fillAddressStep(page);
    console.error(`[${scenario.label}] dependente`);
    await waitForAnyText(page, ["Dependentes", "Adicionar"]);
    let dependentAdditionalAtStep = null;
    const age = scenario.birthDate ? parseAge(scenario.birthDate) : null;
    const expectedAdditionalValue =
      age === null ? null : expectedAdditional(scenario.relationship, age);

    if (scenario.relationship) {
      dependentAdditionalAtStep = await addDependent(
        page,
        scenario.relationship,
        scenario.birthDate,
        index,
      );
    } else {
      await clickButtonByText(page, "Continuar");
    }

    if (process.env.STOP_AFTER_DEPENDENT === "1") {
      return {
        scenario: scenario.label,
        relationship: scenario.relationship,
        age,
        expectedAdditional: expectedAdditionalValue,
        confirmation: { dependentAdditional: dependentAdditionalAtStep },
        registerRequests,
        additionalMatches:
          expectedAdditionalValue === null
            ? dependentAdditionalAtStep === null
            : dependentAdditionalAtStep === `Adicional: ${expectedAdditionalValue}`,
      };
    }
    console.error(`[${scenario.label}] planos`);
    const planStep = await collectPlanStep(page);
    if (process.env.STOP_AFTER_PLANS === "1") {
      return {
        scenario: scenario.label,
        relationship: scenario.relationship ?? null,
        age,
        expectedAdditional: expectedAdditionalValue,
        dependentAdditional: dependentAdditionalAtStep,
        planStep,
        registerRequests,
        additionalMatches:
          !scenario.relationship ||
          (expectedAdditionalValue === null
            ? dependentAdditionalAtStep === null
            : dependentAdditionalAtStep === `Adicional: ${expectedAdditionalValue}`),
      };
    }
    console.error(`[${scenario.label}] confirmacao`);
    await goToConfirmation(page);
    const confirmation = await collectConfirmation(page, scenario.relationship);

    const expectedPlans = expectedPlanFamily(age, scenario.relationship);
    const actualAdditionalValue = confirmation.additionalLine
      ?.replace("Adicionais:", "")
      .trim() ?? null;

    return {
      scenario: scenario.label,
      relationship: scenario.relationship,
      age,
      expectedAdditional: expectedAdditionalValue,
      expectedPlans,
      planStep,
      confirmation,
      actualAdditional: actualAdditionalValue,
      planResponses: planResponses.length,
      registerRequests,
      additionalMatches:
        confirmation.dependentAdditional === `Adicional: ${expectedAdditionalValue}`,
      hasConflictMessage:
        planStep.planNames.length > 0 && planStep.hasNoCompatibleMessage,
      expectedPlanMatched: expectedPlans.some((value) =>
        planStep.planNames.some((name) =>
          name.toLowerCase().includes(value.toLowerCase()),
        ),
      ),
    };
  } catch (error) {
    const screenshotPath = `/tmp/prod-mobile-check-${index}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      scenario: scenario.label,
      relationship: scenario.relationship,
      age: scenario.birthDate ? parseAge(scenario.birthDate) : null,
      error: error instanceof Error ? error.message : String(error),
      screenshotPath,
      planResponses: planResponses.length,
      registerRequests,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/snap/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const results = [];
    const start = Number(process.env.SCENARIO_START ?? 0);
    const limit = Number(process.env.SCENARIO_LIMIT ?? scenarios.length);
    for (
      let index = start;
      index < Math.min(start + limit, scenarios.length);
      index += 1
    ) {
      const result = await runScenario(browser, scenarios[index], index);
      results.push(result);
      console.log(JSON.stringify(result));
    }

    const summary = {
      total: results.length,
      withErrors: results.filter((item) => item.error).length,
      additionalOk: results.filter((item) => item.additionalMatches).length,
      noConflictOk: results.filter((item) => item.hasConflictMessage === false).length,
      noRegisterRequests: results.filter((item) => item.registerRequests === 0).length,
    };

    console.log(JSON.stringify({ summary, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
