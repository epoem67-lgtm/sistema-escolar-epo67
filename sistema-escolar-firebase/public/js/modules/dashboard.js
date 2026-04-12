/**
 * DASHBOARD MODULE
 * Home screen with stats cards (admin vs teacher view)
 */

const Dashboard = (() => {

  async function render() {
    const container = document.getElementById('moduleContainer');
    const user = App.currentUser;

    try {
      container.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Cargando dashboard...</p></div>`;

      let stats;
      if (user.role === 'admin') {
        stats = await getAdminStats();
      } else if (user.role === 'maestro') {
        stats = await getTeacherStats();
      } else {
        stats = { totalStudents: 0, totalTeachers: 0, averageGrade: 0, atRiskStudents: 0 };
      }

      const roleText = user.role === 'admin' ? 'General' : 'Mis Grupos';

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Bienvenido al Sistema Escolar</h1>
              <p class="module-subtitle">Estad\u00edsticas ${roleText}</p>
            </div>
          </div>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-icon success"><span class="material-icons-round">people</span></div>
              <div class="stat-content">
                <div class="stat-label">Total Alumnos</div>
                <div class="stat-number">${stats.totalStudents}</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon primary"><span class="material-icons-round">school</span></div>
              <div class="stat-content">
                <div class="stat-label">Total Docentes</div>
                <div class="stat-number">${stats.totalTeachers}</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon warning"><span class="material-icons-round">trending_up</span></div>
              <div class="stat-content">
                <div class="stat-label">Promedio General</div>
                <div class="stat-number">${stats.averageGrade}</div>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-icon danger"><span class="material-icons-round">warning</span></div>
              <div class="stat-content">
                <div class="stat-label">Alumnos en Riesgo</div>
                <div class="stat-number">${stats.atRiskStudents}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      console.error('Error renderizando dashboard:', error);
      container.innerHTML = `<div class="error-state"><span class="material-icons-round">error</span><p>Error al cargar el dashboard</p></div>`;
      Toast.show('Error al cargar el dashboard', 'error');
    }
  }

  async function getAdminStats() {
    const [students, teachers, grades] = await Promise.all([
      Store.getStudents(),
      Store.getTeachers(),
      Store.getGrades()
    ]);

    let totalGrade = 0;
    let gradeCount = 0;
    grades.forEach(g => {
      if (g.value !== undefined && g.value !== null) {
        totalGrade += g.value;
        gradeCount++;
      }
    });

    const atRiskSnap = await DB.atRisk().get();

    return {
      totalStudents: students.length,
      totalTeachers: teachers.length,
      averageGrade: gradeCount > 0 ? (totalGrade / gradeCount).toFixed(2) : 0,
      atRiskStudents: atRiskSnap.size
    };
  }

  async function getTeacherStats() {
    const teacherDocId = await Store.getTeacherDocId();
    if (!teacherDocId) {
      return { totalStudents: 0, totalTeachers: 1, averageGrade: 0, atRiskStudents: 0 };
    }

    const assignmentsSnap = await DB.assignments().where('teacherId', '==', teacherDocId).get();
    const groupIds = [...new Set(assignmentsSnap.docs.map(doc => doc.data().groupId))];

    let totalStudents = 0;
    let totalGrades = 0;
    let gradeSum = 0;

    for (const groupId of groupIds) {
      const studentsSnap = await DB.students().where('groupId', '==', groupId).get();
      totalStudents += studentsSnap.size;

      const gradesSnap = await DB.grades().where('groupId', '==', groupId).get();
      gradesSnap.forEach(doc => {
        const data = doc.data();
        if (data.value !== undefined) {
          gradeSum += data.value;
          totalGrades++;
        }
      });
    }

    return {
      totalStudents,
      totalTeachers: 1,
      averageGrade: totalGrades > 0 ? (gradeSum / totalGrades).toFixed(2) : 0,
      atRiskStudents: 0
    };
  }

  return { render };
})();

Router.modules['dashboard'] = () => Dashboard.render();
