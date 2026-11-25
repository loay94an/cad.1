const translations: Record<string, string> = {
  'Loading…': 'جارٍ التحميل…',
  'Floor plans': 'المخططات',
  '+ New plan': '+ مخطط جديد',
  'New plan': 'مخطط جديد',
  'Import file…': 'استيراد ملف…',
  'Try the demo house': 'تجربة المنزل التوضيحي',
  'In your account': 'في حسابك',
  'Shared with you': 'مشاركة معك',
  'On this device': 'على هذا الجهاز',
  'Nothing yet. New plans go here; you can also upload the ones on this device.': 'لا توجد مخططات بعد. ستظهر المخططات الجديدة هنا، ويمكنك أيضاً رفع المخططات الموجودة على هذا الجهاز.',
  'No plans yet.': 'لا توجد مخططات بعد.',
  'Start a new plan, then add rooms by typing in the walls you measured with your laser meter.': 'ابدأ مخططاً جديداً، ثم أضف الغرف بإدخال أطوال الجدران التي قستها بمقياس الليزر.',
  'demo house': 'المنزل التوضيحي',
  'Plans are saved in this browser on this device only. Use Export → project file to keep a backup.': 'تُحفظ المخططات في هذا المتصفح على هذا الجهاز فقط. استخدم تصدير ← ملف المشروع للاحتفاظ بنسخة احتياطية.',
  'Plans are saved on this device. Log in to keep them in your account, share them, and add photos to notes.': 'تُحفظ المخططات على هذا الجهاز. سجّل الدخول لحفظها في حسابك ومشاركتها وإضافة الصور إلى الملاحظات.',
  'Log in': 'تسجيل الدخول',
  'Log out': 'تسجيل الخروج',
  'Log in as… (dev)': 'تسجيل الدخول بصفة…',
  'Name of the plan': 'اسم المخطط',
  'My house': 'منزلي',
  'Delete': 'حذف',
  'Close': 'إغلاق',
  '3D view': 'العرض ثلاثي الأبعاد',
  'Save picture': 'حفظ الصورة',
  'Save this view as a picture (PNG)': 'حفظ هذا العرض كصورة (PNG)',
  'What to show': 'ما تريد عرضه',
  'Whole house': 'المنزل بالكامل',
  'Ceilings': 'الأسقف',
  'No ceilings': 'إخفاء الأسقف',
  'See-through ceilings': 'أسقف شفافة',
  'Solid ceilings': 'أسقف مصمتة',
  'Furniture': 'الأثاث',
  'Drag to turn · pinch or scroll to zoom · two fingers or right button to move': 'اسحب لتدوير النموذج · باعد بين إصبعين أو مرّر للتكبير · استخدم إصبعين للتحريك',
  'Show the whole floor': 'إظهار الطابق بالكامل',
  'Export': 'تصدير',
  'Import': 'استيراد',
  'Save': 'حفظ',
  'Cancel': 'إلغاء',
  'Done': 'تم',
  'Back': 'رجوع',
  'Settings': 'الإعدادات',
  'Help': 'مساعدة',
  'Name': 'الاسم',
  'Room': 'غرفة',
  'Rooms': 'الغرف',
  'Floor': 'الطابق',
  'Floors': 'الطوابق',
  'Wall': 'جدار',
  'Walls': 'الجدران',
  'Door': 'باب',
  'Doors': 'الأبواب',
  'Window': 'نافذة',
  'Windows': 'النوافذ',
  'View': 'عرض',
  'Layout': 'تخطيط',
  'Electrical': 'كهرباء',
  'Utilities': 'تمديدات',
  'Furniture mode': 'وضع الأثاث',
  'Quantities': 'الكميات',
  'Versions': 'الإصدارات',
  'Notes': 'ملاحظات',
  'Measure': 'قياس',
  'Undo': 'تراجع',
  'Redo': 'إعادة',
  'Delete plan': 'حذف المخطط',
  'Project file': 'ملف المشروع',
  'PDF': 'ملف PDF',
  'PNG': 'صورة PNG',
  'JPG': 'صورة JPG',
  'SVG': 'ملف SVG',
  'Search': 'بحث',
  'Loading the demo house…': 'جارٍ تحميل المنزل التوضيحي…',
  'The demo house could not be loaded': 'تعذر تحميل المنزل التوضيحي',
  'Tap the next point': 'المس النقطة التالية',
  'Tap a point to start. It snaps to corners and walls.': 'المس نقطة للبدء. يلتقط المؤشر الزوايا والجدران تلقائياً.',
  'Tap the first point for the area': 'المس النقطة الأولى لتحديد المساحة',

};

const attributes = ['title', 'aria-label', 'placeholder', 'alt'];
function translateElement(root: Node) {
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const original = node.nodeValue ?? '';
      const key = original.trim();
      const translated = translations[key];
      if (translated) node.nodeValue = original.replace(key, translated);
      return;
    }
    if (!(node instanceof Element)) return;
    for (const attr of attributes) {
      const value = node.getAttribute(attr);
      if (value && translations[value]) node.setAttribute(attr, translations[value]);
    }
    for (const child of [...node.childNodes]) visit(child);
  };
  visit(root);
}

export function installArabicUi() {
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';
  translateElement(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') translateElement(record.target);
      for (const node of record.addedNodes) translateElement(node);
      if (record.type === 'attributes' && record.target instanceof Element) {
        const target = record.target;
        for (const attr of attributes) {
          const value = target.getAttribute(attr);
          if (value && translations[value]) target.setAttribute(attr, translations[value]);
        }
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
  return () => observer.disconnect();
}
