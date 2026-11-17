import { app, faq } from '../helpers';
const S = 'src/lib/business-records.ts; src/app/api/my/sales';
const note = 'Recording by typing in chat is still being built.';
export const salesStock = [
  faq('sales.record', 'sales-stock', 'partial',
    ['How do I record a sale?', 'I sold something, write it down', 'Add a sale to my records'],
    'Send /shop and use your business records to record a sale. A recorded sale is what you tell Mudaala. It is not payment-verified.',
    { action: app(), src: S, note, needs: 'In-chat sale recording via business-records with confirmation' }),
  faq('sales.export', 'sales-stock', 'partial',
    ['Can I export my sales records?', 'Download my business records', 'Give me my sales report'],
    'Your business records can be exported from your shop dashboard.',
    { action: app(), src: 'src/app/api/my/business-export/route.ts', needs: 'Confirm export UI path and format' }),
  faq('stock.update', 'sales-stock', 'partial',
    ['How do I update my stock?', 'Change how many items I have', 'Track my stock', 'Record stock coming in'],
    'Stock movements can be recorded against your business products in your shop dashboard.',
    { action: app(), src: 'src/lib/business-records.ts stockMovementSchema', note, needs: 'In-chat stock update with confirmation' }),
  faq('sales.expense', 'sales-stock', 'unverified',
    ['How do I record expenses?', 'Add a cost to my records', 'I spent money on stock'],
    'Expenses can be recorded in your business records.', { src: 'none', needs: 'Confirm expense records exist in business-records' }),
];
