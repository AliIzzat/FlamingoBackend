const net = require("net");
const Store = require("../models/Store");

/**
 * Small helpers
 */
function money(value) {
  return Number(value || 0).toFixed(2);
}

function line(text = "", width = 42) {
  const str = String(text ?? "");
  return str.length > width ? str.slice(0, width) : str;
}

function divider(width = 42) {
  return "-".repeat(width);
}

function center(text = "", width = 42) {
  const str = String(text ?? "");
  if (str.length >= width) return str.slice(0, width);
  const left = Math.floor((width - str.length) / 2);
  return " ".repeat(left) + str;
}

function escPosInitialize() {
  return Buffer.from([0x1b, 0x40]); // ESC @
}

function escPosAlignCenter() {
  return Buffer.from([0x1b, 0x61, 0x01]); // ESC a 1
}

function escPosAlignLeft() {
  return Buffer.from([0x1b, 0x61, 0x00]); // ESC a 0
}

function escPosBoldOn() {
  return Buffer.from([0x1b, 0x45, 0x01]); // ESC E 1
}

function escPosBoldOff() {
  return Buffer.from([0x1b, 0x45, 0x00]); // ESC E 0
}

function escPosFeed(lines = 3) {
  return Buffer.from("\n".repeat(lines), "utf8");
}

function escPosCut() {
  return Buffer.from([0x1d, 0x56, 0x00]); // GS V 0
}

/**
 * Build printable store ticket text
 */
function buildStoreTicket(order, store) {
  const width = store?.printer?.paperWidth === "58mm" ? 32 : 42;

  const orderNo = String(order?._id || "").slice(-8).toUpperCase();
  const createdAt = order?.createdAt
    ? new Date(order.createdAt).toLocaleString("en-QA")
    : new Date().toLocaleString("en-QA");

  const customerName = order?.customer?.name || "Customer";
  const customerPhone = order?.customer?.phone || "";
  const addressText = order?.customer?.addressText || "";
  const paymentStatus = order?.payment?.status || "unknown";

  const items = Array.isArray(order?.items) ? order.items : [];

  let total = 0;
  for (const item of items) {
    total += Number(item?.price_snapshot || 0) * Number(item?.qty || 0);
  }

  const lines = [];

  lines.push(center("FLAMANGO DELIVERY", width));
  lines.push(center(store?.name || "STORE", width));
  lines.push(divider(width));
  lines.push(line(`ORDER: ${orderNo}`, width));
  lines.push(line(`DATE : ${createdAt}`, width));
  lines.push(line(`PAY  : ${paymentStatus.toUpperCase()}`, width));
  lines.push(divider(width));
  lines.push(line(`CUSTOMER: ${customerName}`, width));

  if (customerPhone) {
    lines.push(line(`PHONE   : ${customerPhone}`, width));
  }

  if (addressText) {
    lines.push(line(`ADDRESS : ${addressText}`, width));
  }

  lines.push(divider(width));
  lines.push(line("ITEMS", width));
  lines.push(divider(width));

  for (const item of items) {
    const qty = Number(item?.qty || 0);
    const name = item?.name_snapshot || "Item";
    const price = Number(item?.price_snapshot || 0);
    const itemTotal = qty * price;

    lines.push(line(`${qty} x ${name}`, width));
    lines.push(line(`    QAR ${money(price)}   =   QAR ${money(itemTotal)}`, width));
  }

  lines.push(divider(width));
  lines.push(line(`TOTAL: QAR ${money(total)}`, width));

  if (order?.notes) {
    lines.push(divider(width));
    lines.push(line("NOTES:", width));
    lines.push(line(String(order.notes), width));
  }

  lines.push(divider(width));
  lines.push(center("DRIVER PICKUP", width));
  lines.push("");
  lines.push("");
  lines.push("");

  return lines.join("\n");
}

/**
 * Build ESC/POS raw buffer
 */
function buildTicketBuffer(order, store) {
  const ticketText = buildStoreTicket(order, store);

  return Buffer.concat([
    escPosInitialize(),
    escPosAlignCenter(),
    escPosBoldOn(),
    Buffer.from(`${store?.name || "STORE"}\n`, "utf8"),
    escPosBoldOff(),
    escPosAlignLeft(),
    Buffer.from(`${ticketText}\n`, "utf8"),
    escPosFeed(3),
    escPosCut(),
  ]);
}

/**
 * Send raw data to network printer
 */
function sendRawToPrinter(ipAddress, port, buffer) {
  return new Promise((resolve, reject) => {
    if (!ipAddress) {
      return reject(new Error("Printer IP address is missing"));
    }

    const socket = new net.Socket();
    let settled = false;

    socket.setTimeout(10000);

    socket.connect(port || 9100, ipAddress, () => {
      socket.write(buffer, (writeErr) => {
        if (writeErr) {
          if (!settled) {
            settled = true;
            socket.destroy();
            return reject(writeErr);
          }
        }

        socket.end();
      });
    });

    socket.on("timeout", () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error("Printer connection timeout"));
      }
    });

    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(err);
      }
    });

    socket.on("close", () => {
      if (!settled) {
        settled = true;
        resolve(true);
      }
    });
  });
}

/**
 * Main function to print an order to its store printer
 */
async function printOrderToStore(order) {
  if (!order) {
    throw new Error("Order is required");
  }

  const storeId = order?.pickup?.storeId;

  if (!storeId) {
    throw new Error("Order does not contain pickup.storeId");
  }

  const store = await Store.findById(storeId).lean();

  if (!store) {
    throw new Error("Store not found");
  }

  const ticket = buildStoreTicket(order, store);

  console.log("========== STORE TICKET ==========");
  console.log(ticket);
  console.log("==================================");

  return {
    success: true,
    mode: "console-test",
    storeId: String(store._id),
    storeName: store.name,
  };
}

module.exports = {
  buildStoreTicket,
  buildTicketBuffer,
  sendRawToPrinter,
  printOrderToStore,
};