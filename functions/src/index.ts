import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import Odoo = require("odoo-xmlrpc");

admin.initializeApp();

export const syncSuprajitOrders = onSchedule(
  {
    schedule: "every 30 minutes",
    timeoutSeconds: 120, // 2 min max
    retryCount: 0, // No reintentar en falla
    memory: "256MiB",
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (event) => {
    const dbFirestore = admin.firestore();
    try {
      const url = process.env.ODOO_URL;
      const db = process.env.ODOO_DB;
      const username = process.env.ODOO_USERNAME;
      const password = process.env.ODOO_API_KEY;

      if (!url || !db || !username || !password) {
        throw new Error("Faltan variables de entorno de Odoo (.env).");
      }

      const odoo = new Odoo({url, db, username, password});

      await new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        odoo.connect((err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
      logger.info("✅ Conexión a Odoo exitosa.");

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateString = sevenDaysAgo
        .toISOString()
        .replace("T", " ")
        .substring(0, 19);

      const params = {
        domain: [
          ["partner_id.name", "ilike", "SUPRAJIT"],
          ["create_date", ">=", dateString],
        ],
        fields: ["name", "date_order", "amount_total", "state"],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orders = await new Promise<any[]>((resolve, reject) => {
        odoo.execute_kw(
          "sale.order",
          "search_read",
          [params.domain],
          {fields: params.fields},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err: any, value: any[]) => {
            if (err) return reject(err);
            resolve(value);
          }
        );
      });

      logger.info(`🔍 Encontradas ${orders.length} órdenes de SUPRAJIT.`);

      if (orders.length === 0) {
        await dbFirestore.collection("syncMeta").doc("odoo").set({
          lastSyncAt: FieldValue.serverTimestamp(),
          ordersProcessed: 0,
          status: "ok",
        });
        logger.info("✅ Sync completado: 0 órdenes encontradas.");
        return;
      }

      const batch = dbFirestore.batch();

      orders.forEach((order) => {
        const orderId = String(order.name);
        if (!orderId) return;

        const docRef = dbFirestore.collection("workOrders").doc(orderId);

        batch.set(
          docRef,
          {
            ...order,
            lastSyncAt: FieldValue.serverTimestamp(),
          },
          {merge: true}
        );
      });

      await batch.commit();

      await dbFirestore.collection("syncMeta").doc("odoo").set({
        lastSyncAt: FieldValue.serverTimestamp(),
        ordersProcessed: orders.length,
        status: "ok",
      });

      logger.info(`🚀 Éxito: ${orders.length} órdenes en Firestore.`);
    } catch (error) {
      logger.error("❌ Error crítico sincronizando con Odoo:", error);
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await dbFirestore.collection("syncMeta").doc("odoo").set({
        lastSyncAt: FieldValue.serverTimestamp(),
        ordersProcessed: 0,
        status: "error",
        errorMessage: String(error),
      }).catch(() => {/* never crash the error handler */});
    }
  }
);
