import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Pine Labs brand palette ────────────────────────────────────────────────
const PINE_BLUE       = [0, 82, 155]
const PINE_BLUE_LIGHT = [220, 232, 248]
const PINE_GREEN      = [0, 150, 80]
const PINE_RED        = [200, 48, 48]
const DARK            = [28, 32, 40]
const MID_GRAY        = [110, 118, 130]
const LIGHT_BG        = [247, 249, 252]

// A4 constants
const PAGE_W   = 210
const MARGIN   = 14
const CONTENT_W = PAGE_W - MARGIN * 2

// Pine Labs status → friendly display label
const STATUS_LABEL = {
  CREATED:   'PAYMENT INITIATED',
  PAID:      'COMPLETED',
  SUCCESS:   'COMPLETED',
  FAILED:    'FAILED',
  CANCELLED: 'CANCELLED',
}
const STATUS_COLOR = {
  CREATED:   PINE_GREEN,
  PAID:      PINE_GREEN,
  SUCCESS:   PINE_GREEN,
  FAILED:    PINE_RED,
  CANCELLED: [140, 100, 0],
}

// Strip characters jsPDF Helvetica can't render cleanly
function sanitize(text) {
  return (text || '')
    .replace(/₹/g, 'Rs.')
    .replace(/\u2019|\u2018/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/[^\x00-\x7F]/g, '')
}

async function fetchImageAsDataURL(url) {
  try {
    const res  = await fetch(url)
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function addPage(doc) {
  doc.addPage()
  return 20
}

function checkY(doc, y, needed = 30) {
  if (y + needed > 272) return addPage(doc)
  return y
}

function sectionTitle(doc, text, y) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...PINE_BLUE)
  doc.text(text.toUpperCase(), MARGIN, y)
  doc.setDrawColor(...PINE_BLUE)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, y + 1.5, MARGIN + CONTENT_W, y + 1.5)
  return y + 7
}

// ── Main export ────────────────────────────────────────────────────────────
export async function generateSettlementPDF(settlement, dispute = null) {
  const doc        = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const date       = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
  const invoiceNum = `PS-${settlement.session_id.toUpperCase()}`
  const savingsPct = settlement.total_possible > 0
    ? Math.round((settlement.amount_withheld / settlement.total_possible) * 100)
    : 0
  const reducedAmount = Math.max(0, settlement.total_billed - settlement.charged_intervals * 5).toFixed(2)

  // Load Pine Labs logo (non-blocking — skip if unavailable)
  const logoData = await fetchImageAsDataURL('/pine_labs_logo.png')

  let y = 0

  // ══════════════════════════════════════════════════════════════
  // HEADER — Pine Labs branded banner
  // ══════════════════════════════════════════════════════════════
  doc.setFillColor(...PINE_BLUE)
  doc.rect(0, 0, PAGE_W, 44, 'F')

  if (logoData) {
    // Pine Labs logo image (left side of header)
    doc.addImage(logoData, 'PNG', MARGIN, 5, 36, 14)
  } else {
    // Fallback text logo
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.text('PINE LABS', MARGIN, 16)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(180, 210, 255)
    doc.text('Online Payments Platform', MARGIN, 22)
  }

  // Thin white divider
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, 27, PAGE_W - MARGIN, 27)

  // Sub-brand line
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(200, 220, 255)
  doc.text('Powered by PayStream  \u00B7  Autonomous Outcome-Linked Payments', MARGIN, 33)
  doc.text('paystream.ai', MARGIN, 39)

  // Right: SETTLEMENT INVOICE label
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(255, 255, 255)
  doc.text('SETTLEMENT', PAGE_W - MARGIN, 16, { align: 'right' })
  doc.setFontSize(11)
  doc.text('INVOICE', PAGE_W - MARGIN, 24, { align: 'right' })

  // Pine Labs pill badge (bottom-right of header)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(PAGE_W - MARGIN - 34, 30, 34, 8, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...PINE_BLUE)
  doc.text('UAT Environment', PAGE_W - MARGIN - 17, 35.5, { align: 'center' })

  y = 54

  // ══════════════════════════════════════════════════════════════
  // INVOICE META — two columns
  // ══════════════════════════════════════════════════════════════
  const colL = MARGIN
  const colR = MARGIN + CONTENT_W / 2 + 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...DARK)
  doc.text('INVOICE DETAILS', colL, y)
  doc.text('BILLED TO', colR, y)

  y += 3
  doc.setDrawColor(...MID_GRAY)
  doc.setLineWidth(0.2)
  doc.line(colL, y, colL + CONTENT_W / 2 - 5, y)
  doc.line(colR, y, colR + CONTENT_W / 2 - 5, y)

  y += 5
  const leftMeta = [
    ['Invoice No.', invoiceNum],
    ['Issue Date',  date],
    ['Session ID',  settlement.session_id],
    ['Status',      'SETTLED'],
  ]
  const rightMeta = [
    ['Merchant',     'merchant_demo'],
    ['Platform',     'Pine Labs Online (UAT)'],
    ['Currency',     'INR (Indian Rupee)'],
    ['Environment',  'pluraluat.v2.pinepg.in'],
  ]

  const labelW = 28
  leftMeta.forEach(([label, val], i) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...MID_GRAY)
    doc.text(label, colL, y + i * 6)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...DARK)
    doc.text(String(val), colL + labelW, y + i * 6)
  })

  rightMeta.forEach(([label, val], i) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...MID_GRAY)
    doc.text(label, colR, y + i * 6)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...DARK)
    doc.text(String(val), colR + labelW, y + i * 6, { maxWidth: CONTENT_W / 2 - labelW - 2 })
  })

  y += 30

  // ══════════════════════════════════════════════════════════════
  // SUMMARY BOXES — 3 across
  // ══════════════════════════════════════════════════════════════
  y = checkY(doc, y, 36)
  y = sectionTitle(doc, 'Payment Summary', y)

  const boxW = (CONTENT_W - 8) / 3
  const boxes = [
    {
      label: 'AMOUNT BILLED',
      value: `Rs. ${settlement.total_billed.toFixed(2)}`,
      sub:   `of Rs. ${settlement.total_possible.toFixed(2)} contracted`,
      color: PINE_GREEN,
    },
    {
      label: 'AMOUNT WITHHELD',
      value: `Rs. ${settlement.amount_withheld.toFixed(2)}`,
      sub:   'due to service failures',
      color: PINE_RED,
    },
    {
      label: 'MERCHANT SAVINGS',
      value: `${savingsPct}%`,
      sub:   'protected by PayStream',
      color: PINE_BLUE,
    },
  ]

  boxes.forEach((box, i) => {
    const bx = MARGIN + i * (boxW + 4)
    doc.setFillColor(...LIGHT_BG)
    doc.roundedRect(bx, y, boxW, 26, 2, 2, 'F')
    doc.setDrawColor(...box.color)
    doc.setLineWidth(0.8)
    doc.line(bx, y, bx + boxW, y)
    doc.setLineWidth(0.2)
    doc.roundedRect(bx, y, boxW, 26, 2, 2, 'S')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...MID_GRAY)
    doc.text(box.label, bx + boxW / 2, y + 7, { align: 'center' })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...box.color)
    doc.text(box.value, bx + boxW / 2, y + 17, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...MID_GRAY)
    doc.text(box.sub, bx + boxW / 2, y + 23, { align: 'center' })
  })

  y += 34

  // ══════════════════════════════════════════════════════════════
  // INTERVAL BREAKDOWN TABLE
  // ══════════════════════════════════════════════════════════════
  y = checkY(doc, y, 50)
  y = sectionTitle(doc, 'Service Interval Breakdown', y)

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Payment Status', 'Intervals', 'Unit Rate', 'Total Amount', 'Notes']],
    body: [
      ['Charged (Full)',    String(settlement.charged_intervals), 'Rs. 5.00', `Rs. ${(settlement.charged_intervals * 5).toFixed(2)}`, 'Service met contracted standard'],
      ['Paused (Withheld)', String(settlement.paused_intervals),  'Rs. 0.00', 'Rs. 0.00', 'Quality fell below threshold'],
      ['Reduced (Partial)', String(settlement.reduced_intervals), 'Varies',   `Rs. ${reducedAmount}`, 'Partial service delivery'],
    ],
    foot: [[
      'TOTAL',
      String(settlement.charged_intervals + settlement.paused_intervals + settlement.reduced_intervals),
      '',
      `Rs. ${settlement.total_billed.toFixed(2)}`,
      '',
    ]],
    headStyles: { fillColor: PINE_BLUE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, cellPadding: 3 },
    footStyles: { fillColor: PINE_BLUE_LIGHT, textColor: DARK, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 7.5, textColor: DARK, cellPadding: 2.5 },
    alternateRowStyles: { fillColor: LIGHT_BG },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 42 },
      1: { halign: 'center', cellWidth: 20 },
      2: { halign: 'right',  cellWidth: 22 },
      3: { halign: 'right',  cellWidth: 28, fontStyle: 'bold' },
    },
  })

  y = doc.lastAutoTable.finalY + 10

  // ══════════════════════════════════════════════════════════════
  // PINE LABS TRANSACTION REFERENCE
  // ══════════════════════════════════════════════════════════════
  if (settlement.pine_labs_order_id) {
    y = checkY(doc, y, 32)
    y = sectionTitle(doc, 'Pine Labs Transaction Reference', y)

    doc.setFillColor(...PINE_BLUE_LIGHT)
    doc.roundedRect(MARGIN, y, CONTENT_W, 24, 2, 2, 'F')
    doc.setDrawColor(...PINE_BLUE)
    doc.setLineWidth(0.4)
    doc.roundedRect(MARGIN, y, CONTENT_W, 24, 2, 2, 'S')

    // Logo or text inside box
    if (logoData) {
      doc.addImage(logoData, 'PNG', MARGIN + 3, y + 5, 28, 11)
    } else {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...PINE_BLUE)
      doc.text('PINE LABS', MARGIN + 4, y + 8)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...MID_GRAY)
      doc.text('Online Payments', MARGIN + 4, y + 13)
    }

    // Vertical divider
    doc.setDrawColor(...PINE_BLUE)
    doc.setLineWidth(0.3)
    doc.line(MARGIN + 42, y + 3, MARGIN + 42, y + 21)

    // Order ID
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...MID_GRAY)
    doc.text('Order ID', MARGIN + 47, y + 8)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...DARK)
    doc.text(settlement.pine_labs_order_id, MARGIN + 47, y + 14)

    // Status — mapped to friendly label
    const rawStatus    = (settlement.pine_labs_order_status || 'CREATED').toUpperCase()
    const displayLabel = STATUS_LABEL[rawStatus] || rawStatus
    const statusColor  = STATUS_COLOR[rawStatus] || PINE_GREEN

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...MID_GRAY)
    doc.text('Status', PAGE_W - MARGIN - 50, y + 8)

    doc.setFillColor(...statusColor)
    doc.roundedRect(PAGE_W - MARGIN - 50, y + 10, 40, 8, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(255, 255, 255)
    doc.text(displayLabel, PAGE_W - MARGIN - 30, y + 15.5, { align: 'center' })

    y += 32

    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7)
    doc.setTextColor(...MID_GRAY)
    doc.text(
      `Pine Labs order for Rs. ${settlement.total_billed.toFixed(2)} — the autonomously verified amount (contracted: Rs. ${settlement.total_possible.toFixed(2)})`,
      MARGIN, y
    )
    y += 8
  }

  // ══════════════════════════════════════════════════════════════
  // AI SETTLEMENT EXPLANATION
  // ══════════════════════════════════════════════════════════════
  y = checkY(doc, y, 30)
  y = sectionTitle(doc, 'AI Settlement Explanation (Generated by Claude Haiku)', y)

  doc.setFillColor(...LIGHT_BG)
  const explanationLines = doc.splitTextToSize(sanitize(settlement.explanation || ''), CONTENT_W - 8)
  const explanationH     = explanationLines.length * 4.5 + 8
  doc.roundedRect(MARGIN, y, CONTENT_W, explanationH, 2, 2, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...DARK)
  doc.text(explanationLines, MARGIN + 4, y + 6)
  y += explanationH + 8

  // ══════════════════════════════════════════════════════════════
  // DISPUTE PACKAGE (if generated)
  // ══════════════════════════════════════════════════════════════
  if (dispute) {
    y = checkY(doc, y, 40)
    y = sectionTitle(doc, 'Service Quality Breach Notice (Autonomous)', y)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...PINE_RED)
    doc.text(
      `${dispute.violations_count} violations  \u00B7  Rs. ${dispute.total_withheld?.toFixed(2)} withheld  \u00B7  ${dispute.delivery_percent}% service delivery`,
      MARGIN, y
    )
    y += 6

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['SERVICE QUALITY BREACH NOTICE — Full Document']],
      body: [[{ content: sanitize(dispute.document || ''), styles: { fontStyle: 'normal', fontSize: 7, cellPadding: 4 } }]],
      headStyles: { fillColor: [180, 60, 40], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold', cellPadding: 3 },
      bodyStyles: { textColor: DARK, cellPadding: 4, fontSize: 7, lineHeight: 1.4 },
      columnStyles: { 0: { cellWidth: CONTENT_W } },
    })

    y = doc.lastAutoTable.finalY + 8
  }

  // ══════════════════════════════════════════════════════════════
  // CUSTOMER SUPPORT SIGN-OFF
  // ══════════════════════════════════════════════════════════════
  y = checkY(doc, y, 28)
  y = sectionTitle(doc, 'Customer Support', y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...DARK)
  doc.text('For queries related to this settlement, please contact:', MARGIN, y)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...PINE_BLUE)
  doc.text('Arjun Mehta', MARGIN, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...DARK)
  doc.text('Senior Manager, Merchant Settlements', MARGIN, y)
  y += 5
  doc.setTextColor(...MID_GRAY)
  doc.text('Pine Labs Online Payments  \u00B7  arjun.mehta@pinelabs.com  \u00B7  +91 98765 43210', MARGIN, y)
  y += 10

  // ══════════════════════════════════════════════════════════════
  // CLOSING STATEMENT
  // ══════════════════════════════════════════════════════════════
  y = checkY(doc, y, 16)
  doc.setFillColor(240, 245, 255)
  doc.setDrawColor(...PINE_BLUE)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, y, CONTENT_W, 12, 2, 2, 'FD')
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...PINE_BLUE)
  doc.text(
    '"The payment contract enforced itself. No dispute. No chargeback. No human needed."',
    PAGE_W / 2, y + 7.5,
    { align: 'center' }
  )

  // ══════════════════════════════════════════════════════════════
  // FOOTER (on every page)
  // ══════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const footerY = doc.internal.pageSize.getHeight() - 18

    doc.setFillColor(...PINE_BLUE)
    doc.rect(0, footerY - 2, PAGE_W, 20, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(255, 255, 255)
    doc.text('PINE LABS', MARGIN, footerY + 5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(180, 210, 255)
    doc.text('Pine Labs Online  \u00B7  Autonomous Outcome-Linked Payments via PayStream', MARGIN, footerY + 10)
    doc.text('UAT: pluraluat.v2.pinepg.in  \u00B7  This invoice was generated autonomously', MARGIN, footerY + 14.5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(200, 220, 255)
    doc.text(
      `\u00A9 ${new Date().getFullYear()} Pine Labs Pvt. Ltd.  \u00B7  Page ${p} of ${totalPages}`,
      PAGE_W - MARGIN, footerY + 10, { align: 'right' }
    )
    doc.text(
      `Invoice: ${invoiceNum}  \u00B7  ${date}`,
      PAGE_W - MARGIN, footerY + 14.5, { align: 'right' }
    )
  }

  doc.save(`PayStream-Invoice-${settlement.session_id}.pdf`)
}
