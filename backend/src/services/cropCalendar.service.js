/**
 * Crop Calendar Service
 *
 * Generates a season-long task schedule from sowing date + crop master data.
 * Tasks are date-calculated from sowingDate + stageDays from CropMaster.
 *
 * Task types (in order):
 *   land_preparation → seed_treatment → sowing → first_irrigation →
 *   thinning_weeding → fertilizer_basal → fertilizer_topdress_1 → fertilizer_topdress_2 →
 *   pest_spray_1 → pest_spray_2 → flowering_care → pod_formation → harvesting → post_harvest
 */
import prisma from '../config/db.js';

// ── Standard task templates keyed by taskType ─────────────────────────────────
function buildTasks(sowingDate, crop, fertSchedule, maturityDays) {
  const d = (offsetDays) => {
    const dt = new Date(sowingDate);
    dt.setDate(dt.getDate() + offsetDays);
    return dt;
  };

  const tasks = [
    {
      taskType:      'land_preparation',
      title:         'Land Preparation & FYM Application',
      titleHi:       'जमीन तैयारी और खाद डालना',
      description:   'Deep plough 2-3 times, apply 2-3 tonnes FYM/acre, level field.',
      descriptionHi: '2-3 बार गहरी जुताई करें, 2-3 टन गोबर खाद डालें, खेत समतल करें।',
      scheduledDate: d(-14),
      windowStart:   d(-21),
      windowEnd:     d(-7),
    },
    {
      taskType:      'seed_treatment',
      title:         'Seed Treatment',
      titleHi:       'बीज उपचार',
      description:   `Treat ${crop.name} seed with Thiram 75WP @ 3g/kg + Rhizobium culture @ 10g/kg.`,
      descriptionHi: `${crop.nameHi} बीज को थीरम 75WP @ 3g/kg + राइजोबियम कल्चर @ 10g/kg से उपचारित करें।`,
      scheduledDate: d(-2),
      windowStart:   d(-3),
      windowEnd:     d(0),
    },
    {
      taskType:      'sowing',
      title:         'Sowing / Transplanting',
      titleHi:       'बुवाई / रोपाई',
      description:   `Sow ${crop.name} at ${crop.spacing?.rowToRow || '30cm'} × ${crop.spacing?.plantToPlant || '5cm'} spacing. Seed rate: ${crop.seedRate?.value || '-'} ${crop.seedRate?.unit || 'kg/acre'}.`,
      descriptionHi: `${crop.nameHi} की बुवाई ${crop.spacing?.rowToRow || '30cm'} × ${crop.spacing?.plantToPlant || '5cm'} दूरी पर करें।`,
      scheduledDate: d(0),
      windowStart:   d(0),
      windowEnd:     d(7),
    },
    {
      taskType:      'first_irrigation',
      title:         'First Irrigation (Life Irrigation)',
      titleHi:       'पहली सिंचाई (जीवन सिंचाई)',
      description:   'Give life irrigation within 2-3 days of sowing if no rainfall.',
      descriptionHi: 'बुवाई के 2-3 दिन में पहली सिंचाई दें, यदि बारिश न हो।',
      scheduledDate: d(3),
      windowStart:   d(2),
      windowEnd:     d(7),
    },
    {
      taskType:      'thinning_weeding',
      title:         'Thinning & First Weeding',
      titleHi:       'विरलन और पहली निराई',
      description:   'Remove extra seedlings. Manual weeding or herbicide application at 15-20 DAS.',
      descriptionHi: '15-20 दिन में अतिरिक्त पौधे हटाएं और पहली निराई-गुड़ाई करें।',
      scheduledDate: d(18),
      windowStart:   d(14),
      windowEnd:     d(25),
    },
  ];

  // Add fertilizer tasks from crop master schedule
  if (fertSchedule && fertSchedule.length > 0) {
    fertSchedule.forEach((fs, i) => {
      const fertList = fs.fertilizers?.map(f => `${f.name} ${f.quantityPerAcre} ${f.unit}`).join(', ') || '';
      tasks.push({
        taskType:      i === 0 ? 'fertilizer_basal' : `fertilizer_topdress_${i}`,
        title:         `${fs.stage} — Fertilizer Application`,
        titleHi:       `${fs.stage} — खाद डालना`,
        description:   `Apply: ${fertList}`,
        descriptionHi: `डालें: ${fertList}`,
        scheduledDate: d(fs.stageDays || (i === 0 ? 0 : 30 * i)),
        windowStart:   d((fs.stageDays || 0) - 3),
        windowEnd:     d((fs.stageDays || 0) + 5),
      });
    });
  }

  // Pest scouting tasks
  tasks.push({
    taskType:      'pest_spray_1',
    title:         'First Pest & Disease Scouting',
    titleHi:       'पहला कीट और रोग सर्वेक्षण',
    description:   'Scout 10 plants randomly. Check for pest/disease symptoms. Spray if ETL crossed.',
    descriptionHi: 'यादृच्छिक रूप से 10 पौधों की जांच करें। ETL पार होने पर छिड़काव करें।',
    scheduledDate: d(25),
    windowStart:   d(20),
    windowEnd:     d(30),
  });

  tasks.push({
    taskType:      'pest_spray_2',
    title:         'Second Pest Scouting & Preventive Spray',
    titleHi:       'दूसरा कीट सर्वेक्षण और निवारक छिड़काव',
    description:   'Scout crop at critical stage. Apply preventive fungicide if humid weather persists.',
    descriptionHi: 'महत्वपूर्ण अवस्था में फसल की जांच करें। नमी अधिक हो तो निवारक फफूंदनाशक छिड़काव करें।',
    scheduledDate: d(50),
    windowStart:   d(45),
    windowEnd:     d(60),
  });

  tasks.push({
    taskType:      'flowering_care',
    title:         'Flowering Stage Care',
    titleHi:       'फूल आने की अवस्था की देखभाल',
    description:   'Irrigate at flowering. Avoid heavy pesticide spray. Apply boron 0.5g/L for pod setting.',
    descriptionHi: 'फूल आते समय सिंचाई करें। भारी कीटनाशक छिड़काव न करें। बोरॉन 0.5g/L डालें।',
    scheduledDate: d(Math.round(maturityDays * 0.45)),
    windowStart:   d(Math.round(maturityDays * 0.40)),
    windowEnd:     d(Math.round(maturityDays * 0.55)),
  });

  tasks.push({
    taskType:      'pod_formation',
    title:         'Pod / Fruit Formation Check',
    titleHi:       'फली / फल भरने की जांच',
    description:   'Check pod/fruit filling. Irrigate if dry. Watch for pod borers. Apply 0:52:34 @ 5g/L if needed.',
    descriptionHi: 'फली/फल भराई जांचें। सूखे में सिंचाई करें। फली भेदक देखें।',
    scheduledDate: d(Math.round(maturityDays * 0.65)),
    windowStart:   d(Math.round(maturityDays * 0.60)),
    windowEnd:     d(Math.round(maturityDays * 0.75)),
  });

  tasks.push({
    taskType:      'harvesting',
    title:         'Harvesting',
    titleHi:       'फसल कटाई',
    description:   `Harvest at correct maturity stage. Moisture should be < 15% for storage. ${crop.harvestIndicators?.join('; ') || ''}`,
    descriptionHi: `सही परिपक्वता पर काटें। भंडारण के लिए नमी < 15% होनी चाहिए।`,
    scheduledDate: d(maturityDays),
    windowStart:   d(maturityDays - 7),
    windowEnd:     d(maturityDays + 14),
  });

  tasks.push({
    taskType:      'post_harvest',
    title:         'Post-Harvest — Threshing & Storage',
    titleHi:       'कटाई के बाद — गहाई और भंडारण',
    description:   'Thresh promptly. Sun-dry to correct moisture. Treat with storage pesticide if long-term storage.',
    descriptionHi: 'जल्दी गहाई करें। धूप में सुखाएं। लंबे भंडारण के लिए संग्रहण कीटनाशक लगाएं।',
    scheduledDate: d(maturityDays + 10),
    windowStart:   d(maturityDays + 3),
    windowEnd:     d(maturityDays + 21),
  });

  return tasks.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
}

// ── Generate calendar for a farmer ───────────────────────────────────────────
export async function generateCalendar({ userId, cropName, season, year, sowingDate, state, district, fieldName }) {
  // Load crop master
  const crop = await prisma.cropMaster.findFirst({
    where: { name: { equals: cropName, mode: 'insensitive' } },
  });
  if (!crop) throw new Error(`Crop "${cropName}" not found in master database`);

  const tasks = buildTasks(new Date(sowingDate), crop, crop.fertilizerSchedule || [], crop.maturityDays);

  const calendar = await prisma.cropCalendar.create({
    data: {
      userId,
      crop:        crop.name,
      season,
      year:        year || String(new Date(sowingDate).getFullYear()),
      sowingDate:  new Date(sowingDate),
      maturityDays: crop.maturityDays,
      state,
      district,
      fieldName,
      tasks: {
        create: tasks.map(t => ({
          ...t,
          status: new Date(t.scheduledDate) < new Date() ? 'overdue' : 'upcoming',
        })),
      },
    },
    include: { tasks: { orderBy: { scheduledDate: 'asc' } } },
  });

  return calendar;
}

// ── Get today's due tasks across all active calendars ─────────────────────────
export async function getTodaysTasks(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const calendars = await prisma.cropCalendar.findMany({
    where: { userId, isActive: true },
    include: {
      tasks: {
        where: {
          scheduledDate: { gte: today, lt: tomorrow },
          status: { in: ['upcoming', 'due'] },
        },
        orderBy: { scheduledDate: 'asc' },
      },
    },
  });

  const todaysTasks = calendars.flatMap(cal =>
    cal.tasks.map(t => ({ ...t, calendarCrop: cal.crop, calendarSeason: cal.season }))
  );

  // Also include overdue tasks from all active calendars
  const overdueTasks = await prisma.cropCalendarTask.findMany({
    where: {
      calendar: { userId, isActive: true },
      status: 'overdue',
      completedDate: null,
    },
    include: { calendar: { select: { crop: true, season: true } } },
    orderBy: { scheduledDate: 'asc' },
    take: 5,
  });

  return { today: todaysTasks, overdue: overdueTasks };
}
