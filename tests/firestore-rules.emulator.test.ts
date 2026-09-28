import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest"

/**
 * La base (default) de smv-brain la comparten Vision y el Dashboard, y el Dashboard exige la
 * autenticación ANÓNIMA habilitada (TV pública). "Tener sesión" no basta: un anónimo no es usuario de Vision.
 * Correr con: npm run test:rules (levanta el emulador de Firestore).
 */
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
const describeWithEmulator = emulatorHost ? describe : describe.skip
let env: RulesTestEnvironment

const anonimo = () => env.authenticatedContext("anon-1", { firebase: { sign_in_provider: "anonymous" } }).firestore()
const usuario = () => env.authenticatedContext("user-1", { email: "tornero@example.com", firebase: { sign_in_provider: "password" } }).firestore()
const adminDashboard = () => env.authenticatedContext("admin-1", {
  email: "admin@example.com", email_verified: true, admin: true, firebase: { sign_in_provider: "google.com" },
}).firestore()
const sinSesion = () => env.unauthenticatedContext().firestore()

describeWithEmulator("reglas Firestore de Vision en la base compartida con el Dashboard", () => {
  beforeAll(async () => {
    const [host, port] = emulatorHost!.split(":")
    env = await initializeTestEnvironment({
      projectId: "smv-vision-rules",
      firestore: { host, port: Number(port), rules: readFileSync(resolve(import.meta.dirname, "..", "firestore.rules"), "utf8") },
    })
  })

  beforeEach(async () => {
    await env.clearFirestore()
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await Promise.all([
        db.doc("workOrders/ot-1").set({ pieza: "Buje", numeroParte: "P-1" }),
        db.doc("toolcribDrawings/d-1").set({ partId: "p-1", createdByUid: "user-1" }),
        db.doc("purchases/c-1").set({ proveedor: "Acme" }),
        db.doc("company_configs/suprajit").set({ company_name: "Suprajit", delivery_schedule: "L-V", updatedAt: new Date() }),
      ])
    })
  })

  afterAll(async () => { await env?.cleanup() })

  it("un anónimo no lee órdenes de trabajo ni planos", async () => {
    await assertFails(anonimo().doc("workOrders/ot-1").get())
    await assertFails(anonimo().doc("toolcribDrawings/d-1").get())
  })

  it("un anónimo no crea, edita ni borra compras", async () => {
    await assertFails(anonimo().doc("purchases/nueva").set({ proveedor: "X" }))
    await assertFails(anonimo().doc("purchases/c-1").update({ proveedor: "Y" }))
    await assertFails(anonimo().doc("purchases/c-1").delete())
    await assertFails(anonimo().doc("toolingPurchases/t-1").set({ x: 1 }))
    await assertFails(anonimo().doc("partAliases/a-1").set({ x: 1 }))
  })

  it("un usuario real de Vision sigue trabajando igual", async () => {
    await assertSucceeds(usuario().doc("workOrders/ot-1").get())
    await assertSucceeds(usuario().doc("purchases/nueva").set({ proveedor: "X" }))
    await assertFails(usuario().doc("workOrders/ot-1").set({ pieza: "no" }))
  })

  it("sin sesión no hay nada", async () => {
    await assertFails(sinSesion().doc("workOrders/ot-1").get())
    await assertFails(sinSesion().doc("company_configs/suprajit").get())
  })

  it("desplegar las reglas de Vision no rompe al Dashboard (company_configs)", async () => {
    // La TV anónima lee la configuración; solo un admin verificado la cambia (copia fiel de las reglas del Dashboard).
    await assertSucceeds(anonimo().doc("company_configs/suprajit").get())
    await assertFails(anonimo().doc("company_configs/suprajit").update({ company_name: "Z" }))
    await assertSucceeds(adminDashboard().doc("company_configs/suprajit").set({
      company_name: "Suprajit", delivery_schedule: "L-S", updatedAt: new Date(),
    }))
  })

  it("todo lo demás sigue cerrado", async () => {
    await assertFails(usuario().doc("otraColeccion/x").get())
  })
})
