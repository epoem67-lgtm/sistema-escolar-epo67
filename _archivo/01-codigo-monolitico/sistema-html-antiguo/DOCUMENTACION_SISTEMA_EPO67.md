---
name: epo67-sistema-escolar
description: Manage and improve the EPO 67 school management system. Use this whenever working with ESCUELA PREPARATORIA OFICIAL NÚM. 67 data, documents, spreadsheets, or processes. Helps with student records, teacher assignments, grades, attendance, report generation, indicator calculations, troubleshooting formulas, and system architecture improvements. Essential for any task involving the school's Google Sheets integration, Excel controls, or HTML dashboard, or when implementing changes to the school's administrative processes (Ciclo 2025-2026).
---

# EPO 67 Sistema Escolar

Complete guide to managing and improving ESCUELA PREPARATORIA OFICIAL NÚM. 67's integrated school management system. This system combines teacher input via Google Sheets, centralized data control in Excel, and a dashboard UI for institutional reporting.

---

## System Architecture Overview

### High-Level Data Flow

```
Teachers (Google Sheets)
    ↓
Google Sheets Forms & Templates
    ↓
Excel Control Files (validations, formulas, aggregations)
    ↓
HTML Dashboard (institutional view, reporting)
    ↓
Institutional Indicators & Reports
```

### Key Facts About EPO 67

- **Institution**: ESCUELA PREPARATORIA OFICIAL NÚM. 67
- **Academic Year**: Ciclo 2025-2026
- **Shifts**: 2 (TURNO MATUTINO / TURNO VESPERTINO)
- **Structure per shift**: 3 grades (1st, 2nd, 3rd) × 3 groups each = 9 groups per shift, 18 total
- **Group naming**: 1-1, 1-2, 1-3, 2-1, 2-2, 2-3, 3-1, 3-2, 3-3 per shift
- **Total students enrolled**: 368
- **Total teachers**: ~73
- **Subjects per grade**: 11 (varies slightly by grade level)
- **Evaluation periods**: 3 parciales per semester, 2 semesters = 6 parciales annually
- **Data location**: Google Drive folder "ADMINISTRACIÓN ESCOLAR EPO 67"

### Institutional Goals

These targets guide all data reporting and indicator calculations:

1. **Academic Performance**: Average grade ≥ 8.3 across all students
2. **Attendance**: ≥ 80% student attendance (punctuality and presence)
3. **Failure Rate**: ≤ 14% of students with failing grades (< 6.0)

---

## Folder Structure & Data Organization

All files are stored within Google Drive folder: `ADMINISTRACIÓN ESCOLAR EPO 67`

### Directory Layout

```
ADMINISTRACIÓN ESCOLAR EPO 67/
├── TURNO MATUTINO/
│   ├── CONTROL EVALUACIONES/
│   │   ├── 1º PARCIAL/ (grade and partial-specific folders)
│   │   ├── 2º PARCIAL/
│   │   └── ...
│   ├── F1/ (Assessment forms by grade)
│   │   ├── F1-Primer Grado
│   │   ├── F1-Segundo Grado
│   │   └── F1-Tercer Grado
│   ├── LISTAS POR DOCENTE/
│   │   └── [Teacher-specific grade rosters and forms]
│   ├── LISTAS OFICIALES DEL TURNO/
│   │   └── [Master student lists per shift and grade]
│   ├── INDICADORES/
│   │   └── [Institutional KPI calculations and summaries]
│   └── PANEL DE IMPRESIÓN/
│       └── [Print-ready report templates and dashboards]
│
└── TURNO VESPERTINO/
    └── [Same structure as MATUTINO]
```

---

## Data Model & Components

### 1. Students

**Fields captured per student:**
- Student ID (official student number)
- Full name
- Grade level (1, 2, or 3)
- Group (1, 2, or 3)
- Shift (MATUTINO or VESPERTINO)
- Enrollment status (active, transferred, dropped)
- Contact information (for parent/guardian communication)

**Location**: LISTAS OFICIALES DEL TURNO (by shift), organized by grade

### 2. Teachers

**Fields captured per teacher:**
- Teacher ID (official staff number)
- Full name
- Subject(s) taught
- Assigned groups and grades
- Shift assignment
- Contact information

**Location**: LISTAS POR DOCENTE folders, cross-referenced in F1 forms

### 3. Subjects

**Standard subjects per grade**: 11 subjects (varies slightly by grade level)

Examples:
- Spanish (Español/Literature)
- Mathematics (Matemáticas)
- Physics/Chemistry (Física/Química)
- History (Historia)
- English (Inglés)
- Physical Education (Educación Física)
- etc.

**Location**: F1 forms (Assessment forms) define subjects by grade

### 4. Grades & Evaluation System

**Grading scale**: 0.0 - 10.0 (Mexican standard)
- Passing: ≥ 6.0
- Failing: < 6.0

**Evaluation periods (parciales)**:
- Semester 1: 3 parciales (roughly every 4-5 weeks)
- Semester 2: 3 parciales (same rhythm)
- Total: 6 evaluation periods per year

**Partial calculation**: Teachers input raw grades per parcial

**Final grade formula** (typical, verify in Excel):
- Average of all 6 parciales: (P1 + P2 + ... + P6) / 6
- Or weighted average if some parciales are weighted differently

**Location**: CONTROL EVALUACIONES folders (organized by parcial, grade, group)

### 5. Attendance

**Tracked at two levels**:
1. **Punctuality**: On-time arrivals vs tardies
2. **Presence**: Days present vs absent

**Calculation**:
- Attendance % = (Days Present / Total School Days) × 100
- Goal: ≥ 80% per student

**Location**: CONTROL EVALUACIONES or dedicated attendance sheets (verify with school admin)

---

## Key Files & Their Roles

### F1 Forms (Assessment Forms)

**Purpose**: Primary data entry point for teachers
**Files**:
- F1-Primer Grado (1st year students)
- F1-Segundo Grado (2nd year)
- F1-Tercer Grado (3rd year)

**Contains**:
- Student roster (linked from LISTAS OFICIALES)
- Input fields for grades per parcial per subject
- Validation rules (no values > 10, < 0)
- Formulas to calculate final average

**Location**: TURNO [MATUTINO|VESPERTINO] / F1 /

**User**: Teachers (one form per subject per group, or consolidated by teacher)

### CONTROL EVALUACIONES (Grade Control Sheets)

**Purpose**: Centralized validation and aggregation of all grades across shift
**Organization**: By parcial and grade

**Contains**:
- Consolidated grade data from F1 forms
- Formulas to calculate student averages, failure counts
- Flags for data issues (missing grades, impossible values)

**Location**: TURNO [MATUTINO|VESPERTINO] / CONTROL EVALUACIONES / [PARCIAL] /

**Typical subfolder structure**:
```
1º PARCIAL/
├── Primer Grado/
├── Segundo Grado/
└── Tercer Grado/
```

### LISTAS OFICIALES DEL TURNO (Master Student Lists)

**Purpose**: Single source of truth for student enrollment per shift
**Contains**:
- Complete student roster, organized by grade and group
- Student IDs and names (official records)
- Enrollment status markers
- Links from grades back to students

**Location**: TURNO [MATUTINO|VESPERTINO] / LISTAS OFICIALES DEL TURNO /

**Why important**: All grade data must match these official lists to prevent orphaned records

### LISTAS POR DOCENTE (Teacher Grade Lists)

**Purpose**: Individual teacher view of their assigned classes and grade entry
**Contains**:
- Per-teacher organization of groups taught
- Subject-specific grade entry forms
- Teacher-specific contact info
- Integration points with F1 forms

**Location**: TURNO [MATUTINO|VESPERTINO] / LISTAS POR DOCENTE /

### INDICADORES (Institutional Indicators)

**Purpose**: Calculate KPIs against institutional goals
**Files contain formulas** that pull from CONTROL EVALUACIONES and LISTAS OFICIALES:

**Key indicators** (verify exact naming in school's system):
- **Average Grade by Grade/Shift**: Sum of all student averages / count of students
  - Goal: ≥ 8.3
- **Attendance Rate by Grade/Shift**: Sum of attendance % / count of students
  - Goal: ≥ 80%
- **Failure Rate by Grade/Shift**: Count of students with avg < 6.0 / total students
  - Goal: ≤ 14%
- **Pass Rate by Grade/Shift**: 100% - Failure Rate
- **Subject-specific pass rates**: Useful for identifying weak subjects

**Location**: TURNO [MATUTINO|VESPERTINO] / INDICADORES /

### PANEL DE IMPRESIÓN (Print Dashboard)

**Purpose**: Polished, print-ready reports for institutional reporting and parent communication
**Contains**:
- Formatted tables (KPIs, student rankings, subject breakdowns)
- Charts/graphs of institutional trends
- Summary statistics by group, grade, shift
- Ready-to-print or export layouts

**Location**: TURNO [MATUTINO|VESPERTINO] / PANEL DE IMPRESIÓN /

---

## Google Sheets Integration

### Teacher Data Entry Flow

1. **Form Distribution**: Google Forms or linked spreadsheet cells direct teachers to F1
2. **Teacher Input**: Teachers enter grades in F1 forms per parcial
3. **Validation**: Built-in Sheets validation (Data > Validity) ensures:
   - Grades are 0-10 numeric range
   - Required fields are filled
   - Student roster matches LISTAS OFICIALES
4. **Automatic Syncing**: Excel pulls from Sheets (IMPORTRANGE or manual refresh)
5. **Consolidation**: CONTROL EVALUACIONES aggregates Sheets data into unified view

### Common Sheets Formulas to Know

- **IMPORTRANGE**: Pulls data from F1 into Excel
  ```
  =IMPORTRANGE("sheet-url", "Sheet!A1:Z100")
  ```
- **VLOOKUP / XLOOKUP**: Links student data to grades
  ```
  =VLOOKUP(StudentID, LISTAS_OFICIALES, 2, FALSE)
  ```
- **SUMIF / COUNTIF**: Aggregates grades by student or group
  ```
  =SUMIF(GradeRange, ">=6", CountRange) / COUNTA(StudentRange)
  ```

---

## Excel Control System

### Role of Excel

Excel files serve as the **control layer**: they validate, transform, and aggregate data from Google Sheets into institutional reports.

### Common Excel Formulas & Patterns

#### Calculating Student Average (across 6 parciales)

```excel
=AVERAGE(P1Cell, P2Cell, P3Cell, P4Cell, P5Cell, P6Cell)
```

Or with weights (if some parciales count more):

```excel
=(P1*0.15 + P2*0.15 + P3*0.2 + P4*0.2 + P5*0.15 + P6*0.15)
```

#### Counting Failures (students with average < 6.0)

```excel
=COUNTIF(AverageRange, "<6")
```

#### Calculating Average Grade Across All Students

```excel
=AVERAGE(AllStudentAveragesRange)
```

#### Calculating Failure Rate

```excel
=COUNTIF(AverageRange, "<6") / COUNTA(AverageRange)
```

#### Calculating Attendance Rate

```excel
=SUMIF(AttendanceRange, ">=80") / COUNTA(StudentRange)
```

Or if attendance is stored as count:

```excel
=AVERAGE(AttendanceRange)
```

#### Flagging Data Issues

```excel
=IF(AND(StudentIDNotBlank, GradeOutOfRange), "DATA ERROR", "OK")
=IF(NOT(ISNUMBER(GradeCell)), "INVALID ENTRY", "OK")
```

---

## HTML Dashboard

### Purpose

Provides an institutional-level view of:
- Current KPI status vs. targets
- Trends over parciales
- Group/grade comparisons
- Export-ready reports

### Data Integration

The HTML dashboard pulls from Excel files:
1. Reads INDICADORES sheets
2. Displays key metrics in cards/gauges
3. Shows trends across parciales
4. Allows filtering by grade, group, shift

### Typical Dashboard Sections

- **Executive Summary**: Current avg, attendance, failure rate + targets
- **Grade-by-Grade Breakdown**: Compare performance across 1st, 2nd, 3rd year
- **Shift Comparison**: MATUTINO vs VESPERTINO trends
- **Subject Breakdown**: Which subjects have highest failure rates
- **Trend Charts**: How KPIs have moved across parciales
- **Action Items**: Alerts if any goal is at risk

---

## Common Tasks & How to Complete Them

### Task 1: Adding a New Student

**Steps**:

1. **Update LISTAS OFICIALES DEL TURNO**:
   - Open the appropriate shift folder
   - Find the grade/group list
   - Add new row with: Student ID, Name, Grade, Group
   - Ensure no duplicate IDs

2. **Verify in F1 forms**:
   - If using linked data, F1 will auto-populate from LISTAS OFICIALES
   - If manual roster in F1, add student there too

3. **Update CONTROL EVALUACIONES**:
   - If parcial has already started, add student to the grade control sheet
   - Verify formulas in indicator calculations will include new student

4. **Validate**:
   - Confirm student appears in next dashboard refresh
   - Check no #REF! or #N/A errors in related cells

### Task 2: Removing a Student

**Steps**:

1. **Mark in LISTAS OFICIALES**:
   - Option A: Delete row (less common, creates gaps)
   - Option B: Add "Status" column, mark as "Dropped" or "Transferred"

2. **Remove from F1 forms**:
   - Delete or mark student in current parcial forms
   - Leave historical parcial data for records

3. **Recalculate indicators**:
   - If using COUNTIF/SUMIF with range references, they auto-adjust
   - If ranges are hardcoded, update them to exclude removed student

4. **Document**:
   - Note reason and date in a "Removed Students" log

### Task 3: Updating Teacher Assignments

**Steps**:

1. **Identify change**:
   - Who teaches what subject to which group?
   - When does change take effect (immediate or next parcial)?

2. **Update LISTAS POR DOCENTE**:
   - Modify teacher-subject-group mapping
   - Add new teacher if needed

3. **Update F1 forms**:
   - Assign correct teacher to subject form
   - If teacher is shared, clarify in form notes

4. **Update CONTROL EVALUACIONES** (if already in progress):
   - Ensure new teacher's grades go to correct place
   - Merge or split grade columns if needed

5. **Verify links**:
   - Spot-check that student grades flow to correct teacher

### Task 4: Modifying Report Formats

**Steps**:

1. **Identify target file**:
   - PANEL DE IMPRESIÓN files control print/export layout
   - Or create new report file in INDICADORES

2. **Redesign in Excel or Google Sheets**:
   - Keep data source formulas intact
   - Reorder columns, adjust formatting
   - Add new charts/sections if needed

3. **Test**:
   - Verify formulas still pull correct data
   - Check chart ranges are correct
   - Export to PDF/image to verify print layout

4. **Document format change**:
   - Add note in system documentation (version log below)

### Task 5: Adding New Indicators

**Steps**:

1. **Define the indicator**:
   - What data does it combine?
   - What is the calculation formula?
   - Who needs to see it? (which report/dashboard)

2. **Build the formula**:
   - In INDICADORES spreadsheet, create new column/section
   - Use SUMIF, COUNTIF, AVERAGE as appropriate
   - Reference cells in CONTROL EVALUACIONES or LISTAS OFICIALES

3. **Example: "High Achievers Rate" (students with avg ≥ 9.0)**:
   ```excel
   =COUNTIF(AverageRange, ">=9") / COUNTA(StudentRange)
   ```

4. **Add to dashboard**:
   - If using HTML dashboard, update code to display new indicator
   - If using PANEL DE IMPRESIÓN, add row/section to print template

5. **Set goal/target**:
   - Define success criteria (if applicable)
   - Document in version log

### Task 6: Troubleshooting Formula Issues

**Common problems and solutions**:

#### #REF! Error
- **Cause**: Cell reference is broken (deleted cell, wrong sheet name)
- **Fix**: Check formula bar, re-enter correct reference
- **Prevention**: Use INDIRECT() or named ranges for cross-sheet references

#### #N/A Error
- **Cause**: VLOOKUP/XLOOKUP can't find value, usually student ID mismatch
- **Fix**:
  - Verify student ID in lookup table matches exactly
  - Check for leading/trailing spaces: use TRIM()
  - Confirm LISTAS OFICIALES and F1 use same ID format
- **Prevention**: Use data validation to enforce consistent ID format

#### #DIV/0! Error
- **Cause**: Dividing by zero, often "Total students" is 0
- **Fix**:
  - Add IF statement: `=IF(COUNTA(Range)=0, 0, SUMIF(...)/COUNTA(...))`
  - Verify student list isn't empty

#### Incorrect Averages
- **Cause**: Wrong parcial cells referenced, missing data
- **Fix**:
  - Check formula includes all 6 parciales
  - Verify parcial sheets have data (spot-check grades)
  - Use IFERROR to flag missing grades: `=IFERROR(AVERAGE(...), "MISSING")`

#### Grades Above 10 or Below 0
- **Cause**: Data entry error or formula miscalculation
- **Fix**:
  - Use Data Validation in Sheets/Excel to prevent entry > 10
  - Add spreadsheet validation: `=AND(Grade>=0, Grade<=10)`
  - Check formulas aren't multiplying by accident

### Task 7: Generating Reports

**Steps**:

1. **Choose report type**:
   - Institutional summary (all students, all grades)
   - Grade-level report (one grade, all groups)
   - Group report (one specific group)
   - Subject breakdown (performance by subject)

2. **Open PANEL DE IMPRESIÓN**:
   - Select pre-built report template closest to what you need
   - Or create new sheet using INDICADORES data

3. **Verify data freshness**:
   - Check last update timestamp in control files
   - If using IMPORTRANGE or linked data, ensure refresh occurred
   - Manually recalculate (Ctrl+Shift+F9 in Excel) if needed

4. **Customize for audience**:
   - Add title, date, shift name
   - Remove sensitive data if sharing with parents
   - Adjust KPI formatting (percentages, colors, etc.)

5. **Export**:
   - Google Sheets: File > Download > PDF
   - Excel: File > Export > PDF (or Print to PDF)
   - HTML dashboard: Print or screenshot key sections

6. **Archive report**:
   - Save PDF to PANEL DE IMPRESIÓN with date in filename
   - Example: `Reporte_Institucional_2026-04-02.pdf`

---

## Version Log Template

Use this to track changes and improvements to the system over time. Add a new entry each time a significant change is made.

```
Date: YYYY-MM-DD
Made by: [Name]
Change type: [Addition|Modification|Deletion|Bug Fix|Optimization]

Description:
[What changed and why?]

Affected files:
- [List of modified spreadsheets/forms]

Data migration (if any):
[If data was moved/recalculated, document the process]

Validation:
[How was the change tested? Did all indicators recalculate correctly?]

Rollback plan (if needed):
[If change must be undone, what's the procedure?]

Notes:
[Any lessons learned or recommendations for future changes]
```

### Example Entry

```
Date: 2026-04-02
Made by: System Administrator
Change type: Addition

Description:
Added new indicator "High Achievers Rate" (% of students with average ≥ 9.0)
to institutional dashboard. This helps identify high-performing students for
recognition and advanced programs.

Affected files:
- TURNO MATUTINO/INDICADORES/Indicadores Generales.xlsx
- TURNO VESPERTINO/INDICADORES/Indicadores Generales.xlsx
- PANEL DE IMPRESIÓN/Dashboard Institucional.xlsx

Data migration:
No migration needed; formula references existing average calculations.

Validation:
- Tested with sample data from 1º Parcial results
- Verified count of high achievers matches manual spot-check
- Confirmed formula works across all grades and groups

Rollback plan:
Delete column and recalculate SUMIF formulas that depend on it.

Notes:
Consider adding separate report for high achievers by subject to identify
areas of strength school-wide.
```

---

## Instructions for Claude: How to Help Improve the System

When a user asks you to work with the EPO 67 system, follow this approach:

### 1. Understand the Request

- **Clarify scope**: Is this a one-time data update, a process change, or a structural improvement?
- **Identify affected components**: Which files, shifts, grades, or subjects are involved?
- **Check for dependencies**: Will this change affect other parts of the system? (e.g., changing a formula impacts all reports that depend on it)

### 2. Plan the Change

- **Review relevant sections** of this documentation for the affected component
- **Verify data structure**: Confirm how student IDs, grades, or attendance are currently formatted
- **Check for validation rules**: Are there existing constraints that might affect the change?
- **Draft the solution**: Propose concrete steps (formula changes, data entry procedures, etc.)

### 3. Execute Safely

- **Backup first**: If modifying live files, suggest backing up to a dated folder
- **Make targeted changes**: Only modify what's necessary; avoid global find-and-replace without verification
- **Validate incrementally**: After each step, verify results (spot-check calculations, confirm no broken links)
- **Test with sample data first**: If possible, test a change on one group before rolling out to all

### 4. Document & Communicate

- **Add version log entry**: Record what changed, why, and how to verify
- **Explain impact**: Clarify what data will be affected (which students, grades, etc.)
- **Provide rollback instructions**: If the change doesn't work, how to undo it?
- **Update any affected processes**: If this changes how teachers enter data or how reports are generated, communicate the new process

### 5. Verify Success

- **Confirm data consistency**: All student records present, no orphaned entries
- **Recalculate indicators**: Run formulas to ensure KPIs still calculate correctly
- **Spot-check reports**: Manually verify 2-3 student records to ensure accuracy
- **Check dashboard refresh**: Confirm HTML dashboard (if present) displays updated data

### Common Improvement Opportunities

While working on the system, watch for:

- **Data quality issues**: Missing grades, inconsistent student IDs, orphaned records
- **Formula brittleness**: Hardcoded cell ranges instead of named ranges; broken links between sheets
- **Process friction**: Manual steps that could be automated with validation rules or formulas
- **Reporting gaps**: Indicators not tracking institutional goals, or reports difficult to interpret
- **Scalability concerns**: Will current formulas break if more students/teachers are added?

### When to Ask for Help

Flag for the user:
- Changes that require modifying all 18 group rosters
- Changes affecting how teachers enter data (requires training/communication)
- Large structural changes (e.g., adding a 4th evaluation period, changing grading scale)
- Anything that requires access to cloud storage credentials or file sharing permissions

---

## Appendix: Key Contacts & Resources

- **School Administrator**: [Coordinate with for any system-wide changes]
- **IT Support**: [For Google Drive access, file sharing, or connectivity issues]
- **Teacher Lead**: [For input on data entry process, feedback on reports]
- **Parent Communication**: [If system changes affect parent-visible data or reports]

---

## Appendix: Troubleshooting Checklist

When something goes wrong with the system, work through this in order:

- [ ] Confirm the issue: What data is affected? Is it system-wide or one group?
- [ ] Check data currency: Are Sheets data refreshed? Did Excel recalculate (Ctrl+Shift+F9)?
- [ ] Verify no deleted files: Confirm LISTAS OFICIALES, F1 forms, CONTROL EVALUACIONES still exist
- [ ] Spot-check formulas: Open a cell showing wrong data, inspect formula bar for errors
- [ ] Check for circular references: In Excel, use Formulas > Error Checking
- [ ] Verify student ID consistency: Ensure IDs match across LISTAS OFICIALES and grade sheets
- [ ] Review recent changes: Check version log for changes that might have broken something
- [ ] Isolate the problem: Test formula in new sheet with sample data to confirm behavior
- [ ] If still stuck: Contact IT or teacher lead to understand data entry flow, then revisit formulas

---

**Last Updated**: 2026-04-02
**Skill Version**: 1.0
**Status**: Ready for use
