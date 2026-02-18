document.getElementById('addExportBtn').addEventListener('click', function () {
  const tableBody = document.getElementById('exportTableBody');
  const newRow = document.createElement('tr');
  newRow.innerHTML = `
    <td><input type="text" class="form-control url-input" placeholder="Enter URL"></td>
    <td style="text-align: center;"><input class="leagueInfo" type="checkbox"></td>
    <td style="text-align: center;"><input class="weeklyStats" type="checkbox"></td>
    <td style="text-align: center;"><input class="rosters" type="checkbox"></td>
    <td style="text-align: center;"><input class="extraData" type="checkbox"></td>
    <td style="text-align: center;"><input class="autoUpdate" type="checkbox"></td>
    <td style="text-align: center;">
      <button class="add-export-btn btn btn-outline-primary btn-sm">Add</button>
    </td>
  `;
  tableBody.appendChild(newRow);
  newRow.querySelector('.add-export-btn').addEventListener('click', async function () {
    const url = newRow.querySelector('.url-input').value;
    const leagueInfo = newRow.querySelector('.leagueInfo').checked;
    const weeklyStats = newRow.querySelector('.weeklyStats').checked;
    const rosters = newRow.querySelector('.rosters').checked;
    const extraData = newRow.querySelector('.extraData').checked;
    const autoUpdate = newRow.querySelector('.autoUpdate').checked;

    try {
      const response = await fetch(window.location.pathname + '/updateExport', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url,
          leagueInfo,
          weeklyStats,
          rosters,
          extraData,
          autoUpdate,
          editable: true,
        })
      });
      location.reload()
    } catch (error) {
      console.error('Error:', error);
      alert('An error occurred while adding the export URL.');
    }
  });
});

document.querySelectorAll('.remove-export-btn').forEach(btn => {
  btn.addEventListener('click', async function () {
    const row = this.closest('tr');
    const urlCell = row.querySelector('.export-url');
    const url = urlCell.textContent.trim();

    try {
      const response = await fetch(window.location.pathname + '/deleteExport', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({url})
      });

      if (response.ok) {
        location.reload();
      } else {
        alert('Failed to remove export URL.');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('An error occurred while removing the export URL.');
    }
  });
});

const TaskStatus = {
  NOT_STARTED: 0,
  STARTED: 1,
  FINISHED: 2,
  ERROR: 3
};

const StatusLabels = {
  [TaskStatus.NOT_STARTED]: { text: 'Not Started', class: 'secondary' },
  [TaskStatus.STARTED]: { text: 'In Progress', class: 'info' },
  [TaskStatus.FINISHED]: { text: 'Complete', class: 'success' },
  [TaskStatus.ERROR]: { text: 'Error', class: 'danger' }
};

function createStatusBadge(status) {
  const label = StatusLabels[status] || { text: 'Unknown', class: 'secondary' };
  return `<span class="badge bg-${label.class}">${label.text}</span>`;
}

function renderExportStatus(status) {
  let html = '<div class="card mt-3" style="max-width: 500px;">';
  html += '<div class="card-header d-flex justify-content-between align-items-center" style="cursor: pointer;" onclick="this.nextElementSibling.classList.toggle(\'show\')">';
  html += '<span><strong>Export Progress</strong></span>';
  html += '</div>';
  html += '<div class="card-body collapse show" style="text-align: left;">';
  
  // League Info Status
  html += '<div class="mb-2 d-flex justify-content-between align-items-center">';
  html += '<span><strong>League Info:</strong></span>';
  html += createStatusBadge(status.leagueInfo);
  html += '</div>';
  
  // Weekly Data Status
  if (status.weeklyData && status.weeklyData.length > 0) {
    html += '<div class="mb-2">';
    html += '<div class="mb-1"><strong>Weekly Data:</strong></div>';
    status.weeklyData.forEach(week => {
      html += '<div class="ms-3 mb-1 d-flex justify-content-between align-items-center">';
      html += `<span>Week ${week.weekIndex + 1}:</span>`;
      html += createStatusBadge(week.status);
      html += '</div>';
    });
    html += '</div>';
  }
  
  // Rosters Status
  html += '<div class="mb-0 d-flex justify-content-between align-items-center">';
  html += '<span><strong>Rosters:</strong></span>';
  html += createStatusBadge(status.rosters);
  html += '</div>';
  
  html += '</div>';
  html += '</div>';
  return html;
}

function isExportComplete(status) {
  // Check if league info is finished or errored
  const leagueInfoDone = status.leagueInfo === TaskStatus.FINISHED || status.leagueInfo === TaskStatus.ERROR;
  
  // Check if all weekly data is finished or errored
  const weeklyDataDone = !status.weeklyData || status.weeklyData.length === 0 || 
    status.weeklyData.every(week => week.status === TaskStatus.FINISHED || week.status === TaskStatus.ERROR);
  
  // Check if rosters is finished or errored
  const rostersDone = status.rosters === TaskStatus.FINISHED || status.rosters === TaskStatus.ERROR;
  
  return leagueInfoDone && weeklyDataDone && rostersDone;
}

async function pollExportStatus(taskId, feedbackDiv) {
  let pollInterval;
  
  const poll = async () => {
    try {
      const response = await fetch('/dashboard/league/exportStatus', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ taskId })
      });
      
      if (!response.ok) {
        clearInterval(pollInterval);
        feedbackDiv.innerHTML = '<span class="badge bg-danger">Failed to check export status. It is safe to retry the export</span>';
        return;
      }
      
      const data = await response.json();
      
      // Show queue position if in queue
      let statusHTML = '';
      if (data.position > 0) {
        statusHTML = `<div class="alert alert-info" style="max-width: 500px;">
          <strong>In Queue:</strong> Position ${data.position}
        </div>`;
      } else if (data.position === -1) {
        statusHTML = `<div class="alert alert-primary" style="max-width: 500px;">
          <strong>⚙Processing...</strong>
        </div>`;
      }
      
      // Render the current status
      statusHTML += renderExportStatus(data.task.status);
      feedbackDiv.innerHTML = statusHTML;
      
      // Check if export is complete
      if (isExportComplete(data.task.status)) {
        clearInterval(pollInterval);
        
        // Add completion message
        const completeMsg = document.createElement('div');
        completeMsg.className = 'alert alert-dark alert-dismissible fade show mt-2';
        completeMsg.style.maxWidth = '500px';
        completeMsg.innerHTML = `
          Export Complete!
          <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        feedbackDiv.appendChild(completeMsg);
        
        // Reload after a short delay
        setTimeout(() => location.reload(), 3000);
      }
    } catch (error) {
      console.error('Error polling export status:', error);
      clearInterval(pollInterval);
      feedbackDiv.innerHTML = '<span class="badge bg-danger">Error checking export status</span>';
    }
  };
  
  // Poll immediately, then every 5 seconds
  await poll();
  pollInterval = setInterval(poll, 5000);
}

document.getElementById('exportBtn').addEventListener('click', async function () {
  const selectedOption = document.getElementById('exportSelect').value;

  try {
    const feedbackDiv = document.getElementById('exportFeedback');
    feedbackDiv.innerHTML = '<span class="badge bg-info">Starting export...</span>';
    
    const response = await fetch(window.location.pathname + '/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ exportOption: selectedOption })
    });
    
    if (!response.ok) {
      feedbackDiv.innerHTML = '<span class="badge bg-danger">Export failed to start</span>';
      return;
    }
    
    const data = await response.json();
    
    if (!data.taskId) {
      feedbackDiv.innerHTML = '<span class="badge bg-danger">No task ID received</span>';
      return;
    }
    
    // Start polling for status
    await pollExportStatus(data.taskId, feedbackDiv);
    
  } catch (error) {
    console.error('Error exporting:', error);
    const feedbackDiv = document.getElementById('exportFeedback');
    feedbackDiv.innerHTML = '<span class="badge bg-danger">An error occurred while exporting</span>';
  }
});

document.getElementById('unlinkBtn').addEventListener('click', async function () {
  try {
    const response = await fetch(window.location.pathname + '/unlink', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      window.location.href = '/dashboard';
    } else {
      alert('Failed to unlink league.');
    }
  } catch (error) {
    console.error('Error unlinking league:', error);
    alert('An error occurred while unlinking the league.');
  }
});
