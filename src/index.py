### SEÇÃO 1: IMPORTAÇÕES E CONFIGURAÇÃO INICIAL ###
import json
import os
import logging
import time
from datetime import datetime, timedelta, date
import pytz
from pytz import timezone
import requests
from flask import Flask, request, jsonify, Response
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
import schedule
import threading
import matplotlib.pyplot as plt
import pandas as pd
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException
import io
import googleapiclient.http
# Novas importações
import openai
from supabase import create_client, Client as SupabaseClient
from dotenv import load_dotenv
load_dotenv()  # Carrega variáveis do .env

app = Flask(__name__)

# Configura logging detalhado
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Dicionário para rastrear mensagens processadas (em memória)
processed_messages = {}
# Dicionário para rastrear mensagens por conteúdo (para evitar duplicatas sem MessageSid)
processed_by_content = {}
# Contador de mensagens diárias
daily_message_count = {}
DAILY_MESSAGE_LIMIT = 100  # Ajuste conforme o limite da sua conta
# Dicionário para armazenar o saldo de cada usuário (chave: número do contato, valor: saldo)
user_balances = {}

# Função para enviar mensagens via Twilio
def send_message(to_number, body):
    """Envia uma mensagem via Twilio"""
    try:
        message = twilio_client.messages.create(
            body=body,
            from_=TWILIO_PHONE_NUMBER,
            to=to_number
        )
        logger.info(f"📩 Mensagem enviada para {to_number}: {body}")
        return message.sid
    except Exception as e:
        logger.error(f"🔥 Erro ao enviar mensagem para {to_number}: {str(e)}")
        return None

# Agendamento de tarefas
def run_scheduled_tasks():
    """Executa tarefas agendadas"""
    while True:
        schedule.run_pending()
        time.sleep(60)

# Iniciar o agendamento em uma thread separada
threading.Thread(target=run_scheduled_tasks, daemon=True).start()
### SEÇÃO 2: CONSTANTES E CREDENCIAIS ###
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/dialogflow',
    'https://www.googleapis.com/auth/cloud-platform'
]

# IDs essenciais
DIALOGFLOW_PROJECT_ID = 'gestorfinanceiro-cihl'
CONTROL_SPREADSHEET_ID = '1CMd-737C34c64xRbztrxRJlKmBLhYJcCvM2_MRbK7Ao'  # Planilha de controle

# URLs de API
DIALOGFLOW_URL = f"https://dialogflow.googleapis.com/v2/projects/{DIALOGFLOW_PROJECT_ID}/agent/sessions/{{session_id}}:detectIntent"

# Fuso horário de Brasília
BRASILIA_TZ = pytz.timezone('America/Sao_Paulo')

# E-mail para compartilhar as planilhas
SHARE_EMAIL = 'cortesttk711@gmail.com'

# Credenciais do Twilio (obtidas do ambiente)
TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_PHONE_NUMBER = 'whatsapp:+14155238886'  # Número do Twilio

# Novas credenciais de IA e Banco
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

# Inicializa o cliente do Twilio PRIMEIRO
try:
    from twilio.rest import Client as TwilioClient
    twilio_client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    logger.info("✅ Cliente do Twilio inicializado com sucesso")
except Exception as e:
    logger.error(f"🚨 Erro ao inicializar o cliente do Twilio: {str(e)}")
    raise

# Inicializa o cliente do Supabase
try:
    supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    logger.info("✅ Cliente do Supabase inicializado com sucesso")
except Exception as e:
    logger.error(f"🚨 Erro ao inicializar o cliente do Supabase: {str(e)}")
    # Dependendo da criticidade, você pode decidir se quer levantar exceção ou continuar
    # raise

# Inicializa clientes de IA (com tratamento de erro)
try:
    import openai
    openai.api_key = OPENAI_API_KEY
    # Já inicializamos o supabase_client anteriormente, então vamos reutilizar
    logger.info("✅ Cliente OpenAI inicializado com sucesso")
except Exception as e:
    logger.error(f"⚠️ Erro ao inicializar cliente OpenAI: {str(e)}")
    logger.warning("⚠️ Funcionalidades de IA estarão limitadas")
    openai.api_key = None

# Carrega credenciais do Google
try:
    GOOGLE_CREDENTIALS = os.getenv('GOOGLE_CREDENTIALS')
    
    if not GOOGLE_CREDENTIALS:
        raise ValueError("❌ Variável GOOGLE_CREDENTIALS não encontrada")
    
    # Carrega e valida credenciais
    credentials_dict = json.loads(GOOGLE_CREDENTIALS)
    credentials = Credentials.from_service_account_info(
        credentials_dict, 
        scopes=SCOPES
    )
    logger.info("✅ Credenciais do Google validadas com sucesso")

    # Gera o token para o Dialogflow
    credentials.refresh(Request())
    DIALOGFLOW_TOKEN = credentials.token
    logger.info("✅ Token do Dialogflow gerado com sucesso")

except Exception as e:
    logger.error(f"🚨 Erro crítico nas credenciais: {str(e)}")
    raise

# Cache para IDs de planilhas (para reduzir chamadas ao Google Sheets)
spreadsheet_cache = {}
### SEÇÃO 3: FUNÇÕES AUXILIARES PARA CONTROLE DE MENSAGENS ###
def can_send_message():
    """Verifica se é possível enviar uma mensagem sem exceder o limite diário"""
    today = date.today().isoformat()
    if today not in daily_message_count:
        daily_message_count[today] = 0
    
    if daily_message_count[today] >= DAILY_MESSAGE_LIMIT:
        logger.warning(f"⚠️ Limite diário de mensagens atingido: {DAILY_MESSAGE_LIMIT} mensagens")
        return False
    
    daily_message_count[today] += 1
    logger.info(f"📩 Mensagens enviadas hoje: {daily_message_count[today]}/{DAILY_MESSAGE_LIMIT}")
    return True

def clean_old_message_counts():
    """Limpa contadores de mensagens de dias anteriores"""
    today = date.today().isoformat()
    for day in list(daily_message_count.keys()):
        if day != today:
            del daily_message_count[day]

### SEÇÃO 4: FUNÇÕES AUXILIARES PARA GOOGLE DRIVE E SHEETS ###

def parse_currency_to_float(value):
    """Converte uma string de moeda (ex.: 'R$10,000.00') para float (ex.: 10000.0)"""
    try:
        # Remove o símbolo de moeda (R$), espaços, e separadores de milhar (,)
        cleaned_value = value.replace('R$', '').replace(',', '').replace(' ', '')
        # Converte para float
        return float(cleaned_value)
    except (ValueError, TypeError) as e:
        logger.error(f"🔥 Erro ao converter valor para float: {value} - {str(e)}")
        return 0.0

def save_chart_to_drive(buffer, filename, contact_number):
    """Salva o gráfico no Google Drive e retorna a URL pública"""
    try:
        drive_service = build('drive', 'v3', credentials=credentials, cache_discovery=False)
        
        # Cria o arquivo no Google Drive
        file_metadata = {
            'name': filename,
            'mimeType': 'image/png',
            'parents': ['root']  # Pode criar uma pasta específica se preferir
        }
        buffer.seek(0)
        media = googleapiclient.http.MediaIoBaseUpload(buffer, mimetype='image/png')
        file = drive_service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id'
        ).execute()
        
        file_id = file.get('id')
        
        # Torna o arquivo público
        permission = {
            'type': 'anyone',
            'role': 'reader'
        }
        drive_service.permissions().create(
            fileId=file_id,
            body=permission
        ).execute()
        
        # Gera a URL pública
        public_url = f"https://drive.google.com/uc?export=download&id={file_id}"
        logger.info(f"📊 Gráfico salvo no Drive: {public_url}")
        return public_url
    except Exception as e:
        logger.error(f"🔥 Erro ao salvar gráfico no Drive: {str(e)}")
        return None

def create_control_sheet_if_not_exists():
    """Cria a aba 'Controle' na planilha de controle se ela não existir"""
    start_time = time.time()
    try:
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        
        # Verifica se a aba "Controle" existe
        spreadsheet = sheets_service.spreadsheets().get(spreadsheetId=CONTROL_SPREADSHEET_ID).execute()
        sheets = spreadsheet.get('sheets', [])
        sheet_names = [sheet['properties']['title'] for sheet in sheets]
        
        if 'Controle' not in sheet_names:
            # Cria a nova aba "Controle"
            batch_update_request = {
                'requests': [
                    {
                        'addSheet': {
                            'properties': {
                                'title': 'Controle',
                                'gridProperties': {
                                    'rowCount': 1000,
                                    'columnCount': 2
                                }
                            }
                        }
                    }
                ]
            }
            sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=CONTROL_SPREADSHEET_ID,
                body=batch_update_request
            ).execute()
            
            # Adiciona cabeçalhos
            headers = [['Número do Contato', 'ID da Planilha']]
            sheets_service.spreadsheets().values().update(
                spreadsheetId=CONTROL_SPREADSHEET_ID,
                range='Controle!A1:B1',
                valueInputOption='RAW',
                body={'values': headers}
            ).execute()
            
            logger.info("📋 Aba 'Controle' criada com sucesso")
        else:
            logger.info("📋 Aba 'Controle' já existe")
            
    except Exception as e:
        logger.error(f"🔥 Falha ao criar/verificar a aba 'Controle': {str(e)}")
        raise
    finally:
        logger.info(f"⏱️ Tempo para create_control_sheet_if_not_exists: {time.time() - start_time:.2f} segundos")

def share_spreadsheet(spreadsheet_id, email):
    """Compartilha a planilha com o e-mail especificado"""
    start_time = time.time()
    try:
        drive_service = build('drive', 'v3', credentials=credentials, cache_discovery=False)
        permission = {
            'type': 'user',
            'role': 'writer',
            'emailAddress': email
        }
        drive_service.permissions().create(
            fileId=spreadsheet_id,
            body=permission,
            fields='id'
        ).execute()
        logger.info(f"📧 Planilha {spreadsheet_id} compartilhada com {email}")
    except Exception as e:
        logger.error(f"🔥 Falha ao compartilhar planilha {spreadsheet_id} com {email}: {str(e)}")
    finally:
        logger.info(f"⏱️ Tempo para share_spreadsheet: {time.time() - start_time:.2f} segundos")

def create_spreadsheet_for_contact(contact_number):
    """Cria uma nova planilha para o contato e retorna o ID da planilha"""
    start_time = time.time()
    try:
        # Valida o contact_number
        if not contact_number:
            raise ValueError("Número do contato não pode ser None ou vazio")
        
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        drive_service = build('drive', 'v3', credentials=credentials, cache_discovery=False)

        # Determina o mês atual para criar a primeira aba mensal
        today = datetime.now(BRASILIA_TZ)
        month_names = {
            "January": "Janeiro", "February": "Fevereiro", "March": "Março", "April": "Abril",
            "May": "Maio", "June": "Junho", "July": "Julho", "August": "Agosto",
            "September": "Setembro", "October": "Outubro", "November": "Novembro", "December": "Dezembro"
        }
        month_name_en = today.strftime("%B %Y")
        month_name = month_name_en.replace(today.strftime("%B"), month_names[today.strftime("%B")])

        # Cria a planilha com as abas "Resumo", mês atual, "Gastos Recorrentes" e "Lembretes"
        spreadsheet = {
            'properties': {
                'title': f'Finanças - {contact_number}'
            },
            'sheets': [
                {
                    'properties': {
                        'title': 'Resumo',
                        'gridProperties': {
                            'rowCount': 1000,
                            'columnCount': 5  # Período, Receitas, Despesas, Saldo do Mês, Saldo Acumulado
                        }
                    }
                },
                {
                    'properties': {
                        'title': month_name,  # Ex.: "Abril 2025"
                        'gridProperties': {
                            'rowCount': 1000,
                            'columnCount': 7  # Data, Categoria, Valor, Observação, Tipo, Recorrente, Parcela
                        }
                    }
                },
                {
                    'properties': {
                        'title': 'Gastos Recorrentes',
                        'gridProperties': {
                            'rowCount': 1000,
                            'columnCount': 11  # Atualizado para 11 colunas na Etapa 2
                        }
                    }
                },
                {
                    'properties': {
                        'title': 'Lembretes',
                        'gridProperties': {
                            'rowCount': 1000,
                            'columnCount': 5  # Descrição, Categoria, Valor, Dia, Ativo
                        }
                    }
                }
            ]
        }
        spreadsheet = sheets_service.spreadsheets().create(body=spreadsheet).execute()
        spreadsheet_id = spreadsheet['spreadsheetId']

        # Obtém os sheetIds das abas
        spreadsheet_data = sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        sheet_ids = {}
        for sheet in spreadsheet_data.get('sheets', []):
            sheet_title = sheet['properties']['title']
            sheet_ids[sheet_title] = sheet['properties']['sheetId']

        # Configura a aba "Resumo"
        resumo_headers = [
            ['Período', 'Receitas', 'Despesas', 'Saldo do Mês', 'Saldo Acumulado']
        ]
        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range='Resumo!A1:E1',
            valueInputOption='RAW',
            body={'values': resumo_headers}
        ).execute()

        # Configura a aba do mês atual (ex.: "Abril 2025")
        month_headers = [
            ['Data', 'Categoria', 'Valor', 'Observação', 'Tipo', 'Recorrente', 'Parcela']
        ]
        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f'{month_name}!A1:G1',
            valueInputOption='RAW',
            body={'values': month_headers}
        ).execute()

        # Configura a aba "Gastos Recorrentes" (Etapa 2: 11 colunas)
        recurring_headers = [
            ['Descrição', 'Categoria', 'Valor Total', 'Valor da Parcela', 'Parcela Atual', 'Data Início', 'Ativo', 
             'Tipo de Recorrência', 'Dia da Semana', 'Dia do Mês', 'Número de Parcelas']
        ]
        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range='Gastos Recorrentes!A1:K1',  # Ajustado para 11 colunas
            valueInputOption='RAW',
            body={'values': recurring_headers}
        ).execute()

        # Configura a aba "Lembretes"
        reminder_headers = [
            ['Descrição', 'Categoria', 'Valor', 'Dia', 'Ativo']
        ]
        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range='Lembretes!A1:E1',
            valueInputOption='RAW',
            body={'values': reminder_headers}
        ).execute()

        # Aplica formatação para a aba "Resumo"
        requests = [
            # Congelar a primeira linha
            {
                'updateSheetProperties': {
                    'properties': {
                        'sheetId': sheet_ids['Resumo'],
                        'gridProperties': {
                            'frozenRowCount': 1
                        }
                    },
                    'fields': 'gridProperties.frozenRowCount'
                }
            },
            # Formatar a linha 1 (Cabeçalhos) - Fundo cinza claro e texto em negrito
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_ids['Resumo'],
                        'startRowIndex': 0,
                        'endRowIndex': 1,
                        'startColumnIndex': 0,
                        'endColumnIndex': 5
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'backgroundColor': {
                                'red': 0.83,
                                'green': 0.83,
                                'blue': 0.83
                            },
                            'textFormat': {
                                'bold': True
                            },
                            'horizontalAlignment': 'CENTER'
                        }
                    },
                    'fields': 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                }
            },
            # Formatar as colunas B, C, D e E como moeda
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_ids['Resumo'],
                        'startColumnIndex': 1,
                        'endColumnIndex': 5
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'numberFormat': {
                                'type': 'CURRENCY',
                                'pattern': 'R$#,##0.00'
                            },
                            'horizontalAlignment': 'RIGHT'
                        }
                    },
                    'fields': 'userEnteredFormat(numberFormat,horizontalAlignment)'
                }
            },
            # Adicionar bordas
            {
                'updateBorders': {
                    'range': {
                        'sheetId': sheet_ids['Resumo'],
                        'startRowIndex': 0,
                        'endRowIndex': 1000,
                        'startColumnIndex': 0,
                        'endColumnIndex': 5
                    },
                    'top': {'style': 'SOLID', 'width': 1},
                    'bottom': {'style': 'SOLID', 'width': 1},
                    'left': {'style': 'SOLID', 'width': 1},
                    'right': {'style': 'SOLID', 'width': 1},
                    'innerHorizontal': {'style': 'SOLID', 'width': 1},
                    'innerVertical': {'style': 'SOLID', 'width': 1}
                }
            }
        ]

        # Aplica formatação para a aba do mês atual (ex.: "Abril 2025")
        requests.extend([
            # Congelar a primeira linha
            {
                'updateSheetProperties': {
                    'properties': {
                        'sheetId': sheet_ids[month_name],
                        'gridProperties': {
                            'frozenRowCount': 1
                        }
                    },
                    'fields': 'gridProperties.frozenRowCount'
                }
            },
            # Formatar a linha 1 (Cabeçalhos) - Fundo cinza claro e texto em negrito
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_ids[month_name],
                        'startRowIndex': 0,
                        'endRowIndex': 1,
                        'startColumnIndex': 0,
                        'endColumnIndex': 7
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'backgroundColor': {
                                'red': 0.83,
                                'green': 0.83,
                                'blue': 0.83
                            },
                            'textFormat': {
                                'bold': True
                            },
                            'horizontalAlignment': 'CENTER'
                        }
                    },
                    'fields': 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                }
            },
            # Formatar a coluna C (Valor) como moeda
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_ids[month_name],
                        'startColumnIndex': 2,
                        'endColumnIndex': 3
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'numberFormat': {
                                'type': 'CURRENCY',
                                'pattern': 'R$#,##0.00'
                            },
                            'horizontalAlignment': 'RIGHT'
                        }
                    },
                    'fields': 'userEnteredFormat(numberFormat,horizontalAlignment)'
                }
            },
            # Adicionar bordas
            {
                'updateBorders': {
                    'range': {
                        'sheetId': sheet_ids[month_name],
                        'startRowIndex': 0,
                        'endRowIndex': 1000,
                        'startColumnIndex': 0,
                        'endColumnIndex': 7
                    },
                    'top': {'style': 'SOLID', 'width': 1},
                    'bottom': {'style': 'SOLID', 'width': 1},
                    'left': {'style': 'SOLID', 'width': 1},
                    'right': {'style': 'SOLID', 'width': 1},
                    'innerHorizontal': {'style': 'SOLID', 'width': 1},
                    'innerVertical': {'style': 'SOLID', 'width': 1}
                }
            },
            # Adicionar filtros automáticos
            {
                'setBasicFilter': {
                    'filter': {
                        'range': {
                            'sheetId': sheet_ids[month_name],
                            'startRowIndex': 0,
                            'endRowIndex': 1000,
                            'startColumnIndex': 0,
                            'endColumnIndex': 7
                        }
                    }
                }
            }
        ])

        # Aplica formatação para a aba "Gastos Recorrentes" (Etapa 2: 11 colunas)
        requests.extend([
            # Congelar a primeira linha
            {
                'updateSheetProperties': {
                    'properties': {
                        'sheetId': sheet_ids['Gastos Recorrentes'],
                        'gridProperties': {
                            'frozenRowCount': 1
                        }
                    },
                    'fields': 'gridProperties.frozenRowCount'
                }
            },
            # Formatar a linha 1 (Cabeçalhos) - Fundo cinza claro e texto em negrito
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_ids['Gastos Recorrentes'],
                        'startRowIndex': 0,
                        'endRowIndex': 1,
                        'startColumnIndex': 0,
                        'endColumnIndex': 11  # Ajustado para 11 colunas
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'backgroundColor': {
                                'red': 0.83,
                                'green': 0.83,
                                'blue': 0.83
                            },
                            'textFormat': {
                                'bold': True
                            },
                            'horizontalAlignment': 'CENTER'
                        }
                    },
                    'fields': 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                }
            },
            # Formatar as colunas C e D (Valor Total e Valor da Parcela) como moeda
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_ids['Gastos Recorrentes'],
                        'startColumnIndex': 2,
                        'endColumnIndex': 4
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'numberFormat': {
                                'type': 'CURRENCY',
                                'pattern': 'R$#,##0.00'
                            },
                            'horizontalAlignment': 'RIGHT'
                        }
                    },
                    'fields': 'userEnteredFormat(numberFormat,horizontalAlignment)'
                }
            },
            # Adicionar bordas
            {
                'updateBorders': {
                    'range': {
                        'sheetId': sheet_ids['Gastos Recorrentes'],
                        'startRowIndex': 0,
                        'endRowIndex': 1000,
                        'startColumnIndex': 0,
                        'endColumnIndex': 11  # Ajustado para 11 colunas
                    },
                    'top': {'style': 'SOLID', 'width': 1},
                    'bottom': {'style': 'SOLID', 'width': 1},
                    'left': {'style': 'SOLID', 'width': 1},
                    'right': {'style': 'SOLID', 'width': 1},
                    'innerHorizontal': {'style': 'SOLID', 'width': 1},
                    'innerVertical': {'style': 'SOLID', 'width': 1}
                }
            }
        ])

        # Aplica formatação para a aba "Lembretes"
        requests.extend([
            # Congelar a primeira linha
            {
                'updateSheetProperties': {
                    'properties': {
                        'sheetId': sheet_ids['Lembretes'],
                        'gridProperties': {
                            'frozenRowCount': 1
                        }
                    },
                    'fields': 'gridProperties.frozenRowCount'
                }
            },
            # Formatar a linha 1 (Cabeçalhos) - Fundo cinza claro e texto em negrito
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_ids['Lembretes'],
                        'startRowIndex': 0,
                        'endRowIndex': 1,
                        'startColumnIndex': 0,
                        'endColumnIndex': 5
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'backgroundColor': {
                                'red': 0.83,
                                'green': 0.83,
                                'blue': 0.83
                            },
                            'textFormat': {
                                'bold': True
                            },
                            'horizontalAlignment': 'CENTER'
                        }
                    },
                    'fields': 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                }
            },
            # Formatar a coluna C (Valor) como moeda
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_ids['Lembretes'],
                        'startColumnIndex': 2,
                        'endColumnIndex': 3
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'numberFormat': {
                                'type': 'CURRENCY',
                                'pattern': 'R$#,##0.00'
                            },
                            'horizontalAlignment': 'RIGHT'
                        }
                    },
                    'fields': 'userEnteredFormat(numberFormat,horizontalAlignment)'
                }
            },
            # Adicionar bordas
            {
                'updateBorders': {
                    'range': {
                        'sheetId': sheet_ids['Lembretes'],
                        'startRowIndex': 0,
                        'endRowIndex': 1000,
                        'startColumnIndex': 0,
                        'endColumnIndex': 5
                    },
                    'top': {'style': 'SOLID', 'width': 1},
                    'bottom': {'style': 'SOLID', 'width': 1},
                    'left': {'style': 'SOLID', 'width': 1},
                    'right': {'style': 'SOLID', 'width': 1},
                    'innerHorizontal': {'style': 'SOLID', 'width': 1},
                    'innerVertical': {'style': 'SOLID', 'width': 1}
                }
            }
        ])

        sheets_service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={'requests': requests}
        ).execute()

        # Compartilha a planilha com o e-mail especificado
        share_spreadsheet(spreadsheet_id, SHARE_EMAIL)

        # Salva o mapeamento na planilha de controle
        append_to_control_sheet(contact_number, spreadsheet_id)

        # Adiciona ao cache
        spreadsheet_cache[contact_number] = spreadsheet_id

        logger.info(f"📊 Nova planilha criada para {contact_number}: {spreadsheet_id}")
        return spreadsheet_id

    except Exception as e:
        logger.error(f"🔥 Falha ao criar planilha para {contact_number}: {str(e)}")
        return None
    finally:
        logger.info(f"⏱️ Tempo para create_spreadsheet_for_contact: {time.time() - start_time:.2f} segundos")

def append_to_control_sheet(contact_number, spreadsheet_id):
    """Adiciona o mapeamento contato -> planilha na planilha de controle"""
    start_time = time.time()
    try:
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        values = [[contact_number, spreadsheet_id]]
        sheets_service.spreadsheets().values().append(
            spreadsheetId=CONTROL_SPREADSHEET_ID,
            range='Controle!A:B',
            valueInputOption='RAW',
            body={'values': values}
        ).execute()
        logger.info(f"📋 Mapeamento salvo: {contact_number} -> {spreadsheet_id}")
    except Exception as e:
        logger.error(f"🔥 Falha ao salvar mapeamento: {str(e)}")
    finally:
        logger.info(f"⏱️ Tempo para append_to_control_sheet: {time.time() - start_time:.2f} segundos")

def get_spreadsheet_id_for_contact(contact_number):
    """Obtém o ID da planilha do contato ou cria uma nova se não existir"""
    start_time = time.time()
    try:
        # Valida o contact_number
        if not contact_number:
            raise ValueError("Número do contato não pode ser None ou vazio")
        
        # Normaliza o número do contato para sempre incluir 'whatsapp:'
        normalized_contact = contact_number if contact_number.startswith('whatsapp:') else f'whatsapp:+{contact_number}'
        logger.info(f"🔍 Buscando planilha para o contato normalizado: {normalized_contact}")
        
        # Verifica no cache primeiro
        if normalized_contact in spreadsheet_cache:
            logger.info(f"📋 Planilha encontrada no cache para {normalized_contact}: {spreadsheet_cache[normalized_contact]}")
            return spreadsheet_cache[normalized_contact]
        
        # Garante que a aba "Controle" existe
        create_control_sheet_if_not_exists()
        
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=CONTROL_SPREADSHEET_ID,
            range='Controle!A:B'
        ).execute()
        values = result.get('values', [])
        
        logger.info(f"📋 Dados da aba Controle: {values}")

        # Procura o contato na planilha de controle
        for row in values:
            if len(row) >= 2:
                stored_number = row[0].strip()
                if stored_number == normalized_contact:
                    spreadsheet_id = row[1]
                    # Adiciona ao cache
                    spreadsheet_cache[normalized_contact] = spreadsheet_id
                    logger.info(f"📋 Planilha encontrada para {normalized_contact}: {spreadsheet_id}")
                    return spreadsheet_id

        # Se não encontrar, cria uma nova planilha
        logger.info(f"📋 Contato {normalized_contact} não encontrado na aba Controle. Criando nova planilha...")
        return create_spreadsheet_for_contact(normalized_contact)

    except Exception as e:
        logger.error(f"🔥 Falha ao obter planilha para {contact_number}: {str(e)}")
        return None
    finally:
        logger.info(f"⏱️ Tempo para get_spreadsheet_id_for_contact: {time.time() - start_time:.2f} segundos")

def get_or_create_month_sheet(spreadsheet_id, date=None):
    """Obtém ou cria a aba do mês correspondente à data fornecida"""
    try:
        if date is None:
            date = datetime.now(BRASILIA_TZ)
        
        # Determina o nome da aba (ex.: "Abril 2025")
        month_names = {
            "January": "Janeiro", "February": "Fevereiro", "March": "Março", "April": "Abril",
            "May": "Maio", "June": "Junho", "July": "Julho", "August": "Agosto",
            "September": "Setembro", "October": "Outubro", "November": "Novembro", "December": "Dezembro"
        }
        month_name_en = date.strftime("%B %Y")
        month_name = month_name_en.replace(date.strftime("%B"), month_names[date.strftime("%B")])
        
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        
        # Verifica se a aba já existe
        spreadsheet = sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        sheets = spreadsheet.get('sheets', [])
        sheet_names = [sheet['properties']['title'] for sheet in sheets]
        
        if month_name in sheet_names:
            logger.info(f"📋 Aba {month_name} já existe na planilha {spreadsheet_id}")
            return month_name
        
        # Cria a nova aba
        batch_update_request = {
            'requests': [
                {
                    'addSheet': {
                        'properties': {
                            'title': month_name,
                            'gridProperties': {
                                'rowCount': 1000,
                                'columnCount': 7
                            }
                        }
                    }
                }
            ]
        }
        sheets_service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body=batch_update_request
        ).execute()
        
        # Obtém o sheetId da nova aba
        spreadsheet = sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        sheet_id = None
        for sheet in spreadsheet.get('sheets', []):
            if sheet['properties']['title'] == month_name:
                sheet_id = sheet['properties']['sheetId']
                break
        
        # Adiciona cabeçalhos
        headers = [['Data', 'Categoria', 'Valor', 'Observação', 'Tipo', 'Recorrente', 'Parcela']]
        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f'{month_name}!A1:G1',
            valueInputOption='RAW',
            body={'values': headers}
        ).execute()
        
        # Aplica formatação
        requests = [
            # Congelar a primeira linha
            {
                'updateSheetProperties': {
                    'properties': {
                        'sheetId': sheet_id,
                        'gridProperties': {
                            'frozenRowCount': 1
                        }
                    },
                    'fields': 'gridProperties.frozenRowCount'
                }
            },
            # Formatar a linha 1 (Cabeçalhos) - Fundo cinza claro e texto em negrito
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_id,
                        'startRowIndex': 0,
                        'endRowIndex': 1,
                        'startColumnIndex': 0,
                        'endColumnIndex': 7
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'backgroundColor': {
                                'red': 0.83,
                                'green': 0.83,
                                'blue': 0.83
                            },
                            'textFormat': {
                                'bold': True
                            },
                            'horizontalAlignment': 'CENTER'
                        }
                    },
                    'fields': 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                }
            },
            # Formatar a coluna C (Valor) como moeda
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_id,
                        'startColumnIndex': 2,
                        'endColumnIndex': 3
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'numberFormat': {
                                'type': 'CURRENCY',
                                'pattern': 'R$#,##0.00'
                            },
                            'horizontalAlignment': 'RIGHT'
                        }
                    },
                    'fields': 'userEnteredFormat(numberFormat,horizontalAlignment)'
                }
            },
            # Adicionar bordas
            {
                'updateBorders': {
                    'range': {
                        'sheetId': sheet_id,
                        'startRowIndex': 0,
                        'endRowIndex': 1000,
                        'startColumnIndex': 0,
                        'endColumnIndex': 7
                    },
                    'top': {'style': 'SOLID', 'width': 1},
                    'bottom': {'style': 'SOLID', 'width': 1},
                    'left': {'style': 'SOLID', 'width': 1},
                    'right': {'style': 'SOLID', 'width': 1},
                    'innerHorizontal': {'style': 'SOLID', 'width': 1},
                    'innerVertical': {'style': 'SOLID', 'width': 1}
                }
            },
            # Adicionar filtros automáticos
            {
                'setBasicFilter': {
                    'filter': {
                        'range': {
                            'sheetId': sheet_id,
                            'startRowIndex': 0,
                            'endRowIndex': 1000,
                            'startColumnIndex': 0,
                            'endColumnIndex': 7
                        }
                    }
                }
            }
        ]
        sheets_service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={'requests': requests}
        ).execute()
        
        logger.info(f"📋 Aba {month_name} criada na planilha {spreadsheet_id}")
        return month_name
    except Exception as e:
        logger.error(f"🔥 Erro ao obter/criar aba do mês: {str(e)}")
        return None

def append_to_sheets(data, categoria, valor, observacao, spreadsheet_id, contact_number, tipo="Despesa", recorrente="Não", parcela=""):
    """Adiciona dados à aba do mês correspondente e atualiza a aba Resumo"""
    start_time = time.time()
    try:
        # Valida o valor
        try:
            valor_float = float(valor)
        except (ValueError, TypeError):
            logger.error(f"🔥 Valor inválido: {valor}")
            return False, 0.0  # Retorna False e saldo 0 em caso de erro
        
        # Determina a aba do mês com base na data
        data_obj = datetime.strptime(data, '%d/%m/%Y %H:%M:%S').replace(tzinfo=BRASILIA_TZ)
        month_sheet = get_or_create_month_sheet(spreadsheet_id, data_obj)
        if not month_sheet:
            logger.error(f"🔥 Não foi possível determinar a aba do mês para a data {data}")
            return False, 0.0
        
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        
        # Prepara dados para inserção na aba do mês
        values = [[
            data,  # Coluna A: Data
            categoria,  # Coluna B: Categoria
            valor_float,  # Coluna C: Valor
            observacao,  # Coluna D: Observação
            tipo,  # Coluna E: Tipo (Despesa ou Receita)
            recorrente,  # Coluna F: Recorrente (Sim ou Não)
            parcela  # Coluna G: Parcela (ex.: "1/5" ou vazio)
        ]]
        
        # Insere os dados na aba do mês, a partir da linha 2
        result = sheets_service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f'{month_sheet}!A2:G',
            valueInputOption='RAW',
            body={'values': values}
        ).execute()
        
        # Atualiza a aba "Resumo"
        # 1. Obtém os dados atuais da aba "Resumo"
        resumo_headers = [
            ['Totais Gerais', 'Total de Receitas', 'Total de Despesas', 'Saldo Total', ''],
            ['Período', 'Receitas', 'Despesas', 'Saldo do Mês', 'Saldo Acumulado']
        ]
        resumo_data = sheets_service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range='Resumo!A:E'
        ).execute()
        resumo_values = resumo_data.get('values', resumo_headers)  # Inclui cabeçalhos se vazio
        
        # 2. Determina a linha correspondente ao mês
        month_name = month_sheet
        row_index = None
        for idx, row in enumerate(resumo_values[2:], start=3):  # Começa da linha 3 por causa das duas linhas de cabeçalho
            if row and row[0] == month_name:
                row_index = idx
                break
        
        # 3. Se o mês não estiver no resumo, adiciona uma nova linha
        if row_index is None:
            resumo_values.append([month_name, 0, 0, 0, 0])
            row_index = len(resumo_values)
        
        # 4. Obtém os dados da aba do mês para calcular totais
        month_data = sheets_service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f'{month_sheet}!A2:E'
        ).execute()
        month_values = month_data.get('values', [])
        
        total_receitas = 0
        total_despesas = 0
        for row in month_values:
            if len(row) >= 5:
                valor_row = parse_currency_to_float(row[2])  # Usa a função para converter o valor
                tipo_row = row[4]
                if tipo_row == "Receita":
                    total_receitas += valor_row
                else:
                    total_despesas += valor_row
        
        # 5. Calcula os totais gerais e o saldo acumulado
        total_receitas_geral = 0
        total_despesas_geral = 0
        saldo_acumulado = 0
        for idx, row in enumerate(resumo_values[2:], start=3):
            if idx < row_index:
                receitas_row = parse_currency_to_float(row[1]) if row[1] else 0
                despesas_row = parse_currency_to_float(row[2]) if row[2] else 0
                total_receitas_geral += receitas_row
                total_despesas_geral += despesas_row
                saldo_acumulado += parse_currency_to_float(row[3]) if row[3] else 0
        # Adiciona os totais do mês atual
        total_receitas_geral += total_receitas
        total_despesas_geral += total_despesas
        saldo_acumulado += (total_receitas - total_despesas)
        
        # 6. Atualiza a linha do mês na aba "Resumo"
        resumo_values[row_index - 1] = [
            month_name,
            total_receitas,
            total_despesas,
            total_receitas - total_despesas,
            saldo_acumulado
        ]
        
        # 7. Atualiza a linha de "Totais Gerais" (linha 1)
        resumo_values[0] = [
            'Totais Gerais',
            total_receitas_geral,
            total_despesas_geral,
            total_receitas_geral - total_despesas_geral,
            ''
        ]
        
        # 8. Salva os dados atualizados na aba "Resumo"
        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range='Resumo!A1:E' + str(len(resumo_values)),
            valueInputOption='RAW',
            body={'values': resumo_values}
        ).execute()
        
        logger.info(f"📊 Dados salvos: {tipo} - {categoria} - R${valor_float} na aba {month_sheet} da planilha {spreadsheet_id}")
        logger.info(f"📋 Aba Resumo atualizada: Receitas R${total_receitas}, Despesas R${total_despesas}, Saldo Acumulado R${saldo_acumulado}")
        logger.info(f"📋 Totais Gerais: Receitas R${total_receitas_geral}, Despesas R${total_despesas_geral}, Saldo Total R${total_receitas_geral - total_despesas_geral}")
        return True, saldo_acumulado
        
    except Exception as e:
        logger.error(f"🔥 Falha ao salvar no Sheets: {str(e)}")
        return False, 0.0
    finally:
        logger.info(f"⏱️ Tempo para append_to_sheets: {time.time() - start_time:.2f} segundos")

### SEÇÃO 6: FUNÇÕES PARA GERAÇÃO DE RELATÓRIOS ###
def generate_report(contact_number, period_type):
    """Gera e envia o relatório semanal ou mensal para o contato"""
    start_time = time.time()
    try:
        # Verifica se pode enviar a mensagem
        if not can_send_message():
            logger.error(f"🔥 Limite diário de mensagens atingido. Não é possível enviar o relatório para {contact_number}")
            return

        # Obtém o ID da planilha do contato
        spreadsheet_id = get_spreadsheet_id_for_contact(contact_number)
        if not spreadsheet_id:
            logger.error(f"🔥 Não foi possível encontrar a planilha para {contact_number}")
            if can_send_message():
                twilio_client.messages.create(
                    body="⚠️ Erro ao acessar a planilha. Tente novamente mais tarde.",
                    from_=TWILIO_PHONE_NUMBER,
                    to=contact_number
                )
            return

        # Define o intervalo de datas
        today = datetime.now(BRASILIA_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        if period_type == 'Semanal':
            # Última semana (segunda a domingo)
            end_date = today - timedelta(days=today.weekday() + 1)  # Último domingo
            start_date = end_date - timedelta(days=6)  # Segunda-feira anterior
            period_label = f"Semanal ({start_date.strftime('%d/%m/%Y')} - {end_date.strftime('%d/%m/%Y')})"
        else:  # Mensal
            # Último mês
            end_date = today.replace(day=1) - timedelta(days=1)  # Último dia do mês anterior
            start_date = end_date.replace(day=1)  # Primeiro dia do mês anterior
            period_label = f"Mensal ({start_date.strftime('%m/%Y')})"

        # Obtém os dados de despesas
        df = get_expenses_data(spreadsheet_id, start_date, end_date)
        if df.empty:
            message = f"📊 *Relatório {period_label}*\n\nNenhuma despesa registrada no período."
            if can_send_message():
                twilio_client.messages.create(
                    body=message,
                    from_=TWILIO_PHONE_NUMBER,
                    to=contact_number
                )
            logger.info(f"📩 Relatório {period_type} enviado para {contact_number}: Nenhuma despesa")
            return

        # Obtém os dados do período anterior para comparação
        df_previous = get_previous_period_data(spreadsheet_id, start_date, end_date)
        total_previous = df_previous['Valor'].sum() if not df_previous.empty else 0

        # Calcula o resumo
        total_expenses = df['Valor'].sum()
        category_sum = df.groupby('Categoria')['Valor'].sum()
        top_category = category_sum.idxmax()
        top_category_value = category_sum.max()

        # Calcula a variação em relação ao período anterior
        variation = ((total_expenses - total_previous) / total_previous * 100) if total_previous > 0 else 0

        # Gera os gráficos
        pie_chart_url = generate_pie_chart(df, period_label, contact_number)
        bar_chart_url = generate_bar_chart(df, period_type, contact_number)

        # Monta o relatório
        report_message = (
            f"📊 *Relatório {period_label}*\n\n"
            f"💰 *Total de Gastos*: R$ {total_expenses:.2f}\n"
            f"📈 *Categoria com Maior Gasto*: {top_category} (R$ {top_category_value:.2f})\n\n"
            "*Gastos por Categoria:*\n"
        )
        for category, value in category_sum.items():
            report_message += f"- {category}: R$ {value:.2f}\n"

        # Adiciona comparação com o período anterior
        if total_previous > 0:
            if variation > 0:
                report_message += f"\n📈 Seus gastos aumentaram {variation:.1f}% em relação ao período anterior (R$ {total_previous:.2f})."
            elif variation < 0:
                report_message += f"\n📉 Parabéns! Seus gastos diminuíram {abs(variation):.1f}% em relação ao período anterior (R$ {total_previous:.2f}). 🎉"
            else:
                report_message += "\n⚖️ Seus gastos foram iguais aos do período anterior."
        else:
            report_message += "\n⚠️ Não há dados do período anterior para comparação."

        # Adiciona uma dica personalizada
        if top_category_value > total_expenses * 0.5:  # Se a maior categoria representa mais de 50% do total
            report_message += f"\n💡 *Dica*: Você gastou bastante com {top_category} (R$ {top_category_value:.2f}). Que tal avaliar formas de reduzir esses gastos?"

        # Adiciona um convite para mais detalhes
        report_message += "\n\n📋 Digite 'detalhes {0}' para ver mais informações!".format('semana' if period_type == 'Semanal' else 'mês')

        # Envia o relatório de texto
        if can_send_message():
            twilio_client.messages.create(
                body=report_message,
                from_=TWILIO_PHONE_NUMBER,
                to=contact_number
            )

        # Envia os gráficos (se existirem)
        if pie_chart_url and can_send_message():
            twilio_client.messages.create(
                body="📊 Gráfico de Distribuição por Categoria",
                from_=TWILIO_PHONE_NUMBER,
                to=contact_number,
                media_url=[pie_chart_url]
            )
        if bar_chart_url and can_send_message():
            twilio_client.messages.create(
                body="📈 Gráfico de Evolução dos Gastos",
                from_=TWILIO_PHONE_NUMBER,
                to=contact_number,
                media_url=[bar_chart_url]
            )

        logger.info(f"📩 Relatório {period_type} enviado para {contact_number}")

    except TwilioRestException as e:
        logger.error(f"🔥 Falha ao enviar relatório {period_type} para {contact_number}: {str(e)}")
    except Exception as e:
        logger.error(f"🔥 Falha ao gerar relatório {period_type} para {contact_number}: {str(e)}")
    finally:
        logger.info(f"⏱️ Tempo para generate_report: {time.time() - start_time:.2f} segundos")

def generate_current_week_summary(contact_number):
    """Gera e envia o resumo dos gastos da semana atual para o contato"""
    start_time = time.time()
    try:
        # Verifica se pode enviar a mensagem
        if not can_send_message():
            logger.error(f"🔥 Limite diário de mensagens atingido. Não é possível enviar o resumo para {contact_number}")
            return

        # Obtém o ID da planilha do contato
        spreadsheet_id = get_spreadsheet_id_for_contact(contact_number)
        if not spreadsheet_id:
            logger.error(f"🔥 Não foi possível encontrar a planilha para {contact_number}")
            if can_send_message():
                twilio_client.messages.create(
                    body="⚠️ Erro ao acessar a planilha. Tente novamente mais tarde.",
                    from_=TWILIO_PHONE_NUMBER,
                    to=contact_number
                )
            return

        # Define o intervalo de datas para a semana atual (segunda-feira até hoje)
        today = datetime.now(BRASILIA_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        start_date = today - timedelta(days=today.weekday())  # Segunda-feira desta semana
        end_date = today  # Até o dia atual
        period_label = f"Semana Atual ({start_date.strftime('%d/%m/%Y')} - {end_date.strftime('%d/%m/%Y')})"

        # Obtém os dados de despesas
        df = get_expenses_data(spreadsheet_id, start_date, end_date)
        if df.empty:
            message = f"📊 *Resumo {period_label}*\n\nNenhuma despesa registrada no período."
            if can_send_message():
                twilio_client.messages.create(
                    body=message,
                    from_=TWILIO_PHONE_NUMBER,
                    to=contact_number
                )
            logger.info(f"📩 Resumo da semana atual enviado para {contact_number}: Nenhuma despesa")
            return

        # Calcula o resumo
        total_expenses = df['Valor'].sum()
        category_sum = df.groupby('Categoria')['Valor'].sum()
        top_category = category_sum.idxmax()
        top_category_value = category_sum.max()

        # Monta o resumo
        summary_message = (
            f"📊 *Resumo {period_label}*\n\n"
            f"💰 *Total de Gastos*: R$ {total_expenses:.2f}\n"
            f"📈 *Categoria com Maior Gasto*: {top_category} (R$ {top_category_value:.2f})\n\n"
            "*Gastos por Categoria:*\n"
        )
        for category, value in category_sum.items():
            summary_message += f"- {category}: R$ {value:.2f}\n"

        # Adiciona uma dica personalizada
        if top_category_value > total_expenses * 0.5:  # Se a maior categoria representa mais de 50% do total
            summary_message += f"\n💡 *Dica*: Você gastou bastante com {top_category} (R$ {top_category_value:.2f}). Que tal avaliar formas de reduzir esses gastos?"

        # Envia o resumo
        if can_send_message():
            twilio_client.messages.create(
                body=summary_message,
                from_=TWILIO_PHONE_NUMBER,
                to=contact_number
            )

        logger.info(f"📩 Resumo da semana atual enviado para {contact_number}")

    except TwilioRestException as e:
        logger.error(f"🔥 Falha ao enviar resumo da semana atual para {contact_number}: {str(e)}")
    except Exception as e:
        logger.error(f"🔥 Falha ao gerar resumo da semana atual para {contact_number}: {str(e)}")
    finally:
        logger.info(f"⏱️ Tempo para generate_current_week_summary: {time.time() - start_time:.2f} segundos")

def generate_detailed_report(contact_number, period_type):
    """Gera e envia os detalhes das despesas do período especificado"""
    start_time = time.time()
    try:
        # Verifica se pode enviar a mensagem
        if not can_send_message():
            logger.error(f"🔥 Limite diário de mensagens atingido. Não é possível enviar os detalhes para {contact_number}")
            return

        # Obtém o ID da planilha do contato
        spreadsheet_id = get_spreadsheet_id_for_contact(contact_number)
        if not spreadsheet_id:
            logger.error(f"🔥 Não foi possível encontrar a planilha para {contact_number}")
            if can_send_message():
                twilio_client.messages.create(
                    body="⚠️ Erro ao acessar a planilha. Tente novamente mais tarde.",
                    from_=TWILIO_PHONE_NUMBER,
                    to=contact_number
                )
            return

        # Define o intervalo de datas
        today = datetime.now(BRASILIA_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        if period_type == 'Semanal':
            # Última semana (segunda a domingo)
            end_date = today - timedelta(days=today.weekday() + 1)  # Último domingo
            start_date = end_date - timedelta(days=6)  # Segunda-feira anterior
            period_label = f"Detalhes da Semana ({start_date.strftime('%d/%m/%Y')} - {end_date.strftime('%d/%m/%Y')})"
        else:  # Mensal
            # Último mês
            end_date = today.replace(day=1) - timedelta(days=1)  # Último dia do mês anterior
            start_date = end_date.replace(day=1)  # Primeiro dia do mês anterior
            period_label = f"Detalhes do Mês ({start_date.strftime('%m/%Y')})"

        # Obtém os dados de despesas
        df = get_expenses_data(spreadsheet_id, start_date, end_date)
        if df.empty:
            message = f"📋 *{period_label}*\n\nNenhuma despesa registrada no período."
            if can_send_message():
                twilio_client.messages.create(
                    body=message,
                    from_=TWILIO_PHONE_NUMBER,
                    to=contact_number
                )
            logger.info(f"📩 Detalhes do período {period_type} enviados para {contact_number}: Nenhuma despesa")
            return

        # Monta a mensagem de detalhes
        total_expenses = df['Valor'].sum()
        details_message = (
            f"📋 *{period_label}*\n\n"
            f"💰 *Total de Gastos*: R$ {total_expenses:.2f}\n\n"
            "*Detalhes das Despesas:*\n"
        )
        for index, row in df.iterrows():
            data = row['Data'].strftime('%d/%m/%Y %H:%M:%S')
            categoria = row['Categoria']
            valor = row['Valor']
            observacao = row['Observação'] if pd.notna(row['Observação']) else 'Nenhuma'
            details_message += (
                f"📅 {data}\n"
                f"📂 {categoria}: R$ {valor:.2f}\n"
                f"📝 Observação: {observacao}\n"
                "------------------------\n"
            )

        # Envia os detalhes
        if can_send_message():
            twilio_client.messages.create(
                body=details_message,
                from_=TWILIO_PHONE_NUMBER,
                to=contact_number
            )

        logger.info(f"📩 Detalhes do período {period_type} enviados para {contact_number}")

    except TwilioRestException as e:
        logger.error(f"🔥 Falha ao enviar detalhes do período {period_type} para {contact_number}: {str(e)}")
    except Exception as e:
        logger.error(f"🔥 Falha ao gerar detalhes do período {period_type} para {contact_number}: {str(e)}")
    finally:
        logger.info(f"⏱️ Tempo para generate_detailed_report: {time.time() - start_time:.2f} segundos")

### SEÇÃO 7: FUNÇÕES PARA AGENDAMENTO DE RELATÓRIOS ###
def send_weekly_reports():
    """Envia relatórios semanais para todos os contatos"""
    logger.info("📅 Iniciando envio de relatórios semanais")
    sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
    result = sheets_service.spreadsheets().values().get(
        spreadsheetId=CONTROL_SPREADSHEET_ID,
        range='Controle!A:B'
    ).execute()
    values = result.get('values', [])
    
    for row in values[1:]:  # Ignora o cabeçalho
        contact_number = row[0]
        generate_report(contact_number, 'Semanal')

def send_monthly_reports():
    """Envia relatórios mensais para todos os contatos no dia 1º de cada mês"""
    today = datetime.now(BRASILIA_TZ)
    if today.day != 1:  # Só executa no dia 1º
        logger.info("📅 Não é dia 1º do mês, pulando envio de relatórios mensais")
        return
    
    logger.info("📅 Iniciando envio de relatórios mensais")
    sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
    result = sheets_service.spreadsheets().values().get(
        spreadsheetId=CONTROL_SPREADSHEET_ID,
        range='Controle!A:B'
    ).execute()
    values = result.get('values', [])
    
    for row in values[1:]:  # Ignora o cabeçalho
        contact_number = row[0]
        generate_report(contact_number, 'Mensal')

def schedule_reports():
    """Agenda o envio de relatórios semanais e mensais"""
    # Relatórios semanais: toda segunda-feira às 08:00
    schedule.every().monday.at("08:00").do(send_weekly_reports)
    
    # Relatórios mensais: verifica todo dia às 08:00, mas só executa no dia 1º
    schedule.every().day.at("08:00").do(send_monthly_reports)

    logger.info("📅 Agendamento de relatórios semanais e mensais configurado")

    while True:
        schedule.run_pending()
        time.sleep(60)  # Verifica a cada minuto

# === SEÇÃO 8: FUNÇÕES PARA PROCESSAMENTO DE RESPOSTAS DO DIALOGFLOW ===
import time
from datetime import datetime
from typing import Any, Dict, Tuple

# --- Helpers de parsing e normalização --- #
def _first_from_param(value: Any):
    """
    Recebe um valor que pode ser lista, dict ou primitivo e tenta extrair o primeiro item útil.
    """
    if value is None:
        return None
    if isinstance(value, list):
        return value[0] if value else None
    return value

def _parse_numeric_value(raw):
    """
    Tenta extrair um float de formatos comuns:
    - '1234.56', '1.234,56', 'R$ 1.234,56', [1234], etc.
    Retorna float ou raise ValueError.
    """
    if raw is None:
        raise ValueError("valor nulo")
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    # remove currency symbols e espaços
    s = s.replace("R$", "").replace("r$", "").replace(" ", "")
    # substituir ponto de milhar e vírgula decimal: "1.234,56" -> "1234.56"
    # estratégia: se houver vírgula e ponto, remover pontos e trocar vírgula por ponto
    if s.count(",") >= 1 and s.count(".") >= 1:
        s = s.replace(".", "").replace(",", ".")
    else:
        # trocar vírgula por ponto (se houver)
        s = s.replace(",", ".")
    # manter somente números, sinal e ponto
    import re
    m = re.search(r"-?\d+(\.\d+)?", s)
    if not m:
        raise ValueError(f"Formato numérico inválido: {raw}")
    return float(m.group())

def _normalize_category(cat_raw: Any) -> str:
    cat = _first_from_param(cat_raw)
    if not cat:
        return "Outros"
    if isinstance(cat, str):
        c = cat.strip()
        return c if c else "Outros"
    return str(cat)

# --- Proteção de duplicatas (em memória) --- #
# processed_messages e processed_by_content devem existir no escopo global.
# Exemplo:
# processed_messages = {}       # MessageSid -> timestamp
# processed_by_content = {}     # "contact:message" -> timestamp

DEDUP_TIME_SECONDS = 10  # tempo para considerar duplicata por conteúdo

def _is_duplicate(message_id: str, contact_number: str, user_message: str) -> Tuple[bool, str]:
    """
    Verifica duplicatas por message_id (MessageSid) e por conteúdo (contact:message).
    Retorna (is_dup, reason).
    """
    now = time.time()
    # message_id dedupe
    if message_id:
        last = processed_messages.get(message_id)
        if last:
            return True, "message_id"
        # register later after passing checks

    # content dedupe
    content_key = f"{contact_number}:{(user_message or '').strip()}"
    last_content = processed_by_content.get(content_key)
    if last_content and (now - last_content) < DEDUP_TIME_SECONDS:
        return True, "content"

    return False, ""

def _register_processed(message_id: str, contact_number: str, user_message: str):
    """Registra timestamps para deduplicação e limpa entradas antigas."""
    now = time.time()
    if message_id:
        processed_messages[message_id] = now
    content_key = f"{contact_number}:{(user_message or '').strip()}"
    processed_by_content[content_key] = now

    # Limpeza simples: remove registros com > 5 minutos
    cutoff = now - (5 * 60)
    for k, ts in list(processed_messages.items()):
        if ts < cutoff:
            processed_messages.pop(k, None)
    for k, ts in list(processed_by_content.items()):
        if ts < cutoff:
            processed_by_content.pop(k, None)

# --- Função principal: processamento de resposta Dialogflow com fallback --- #
def handle_dialogflow_response(query_result: Dict[str, Any], contact_number: str, message_id: str, user_message: str) -> Dict[str, Any]:
    """
    Processa a resposta com IA primeiro; se IA não gerar resposta apropriada, usa lógica do Dialogflow.
    Retorna dict com 'fulfillmentText' (formato esperado pelo webhook).
    """
    start_time = time.time()

    try:
        # validações iniciais
        if not contact_number:
            logger.error("Número do contato ausente")
            return {'fulfillmentText': '⚠️ Número de contato ausente.'}

        # dedupe
        is_dup, reason = _is_duplicate(message_id, contact_number, user_message)
        if is_dup:
            logger.warning(f"Mensagem duplicada detectada ({reason}). message_id={message_id}")
            return {'fulfillmentText': 'Mensagem já processada anteriormente.'}

        # registramos como processado (agora)
        _register_processed(message_id, contact_number, user_message)
        logger.info(f"Mensagens rastreadas: ids={len(processed_messages)}, conteúdos={len(processed_by_content)}")

        # --- tentativa com IA (processar_com_ia) ---
        try:
            resposta_ia = processar_com_ia(contact_number, user_message)
            if resposta_ia:
                elapsed = time.time() - start_time
                logger.info(f"Resposta por IA pronta em {elapsed:.2f}s para {contact_number}")
                return {'fulfillmentText': resposta_ia}
        except Exception as e:
            logger.error(f"Erro ao processar com IA (fallback continuará): {e}")

        # --- fallback: interpretar resultado do Dialogflow (intent + params) ---
        intent = (query_result.get('intent') or {}).get('displayName') or ""
        params = query_result.get('parameters') or {}

        if not intent:
            logger.warning("Intent não identificada no Dialogflow")
            return {'fulfillmentText': '⚠️ Não foi possível identificar a intenção. Pode repetir?'}

        intent_lower = intent.lower()

        # --- Exemplo: registrar gastos (intent 'registrar gastos') ---
        if intent_lower == 'registrar gastos':
            # extrai valor de vários lugares possíveis
            valor_param = params.get('valor') or params.get('Valor') or params.get('number') or params.get('amount')
            valor_raw = _first_from_param(valor_param)

            # se vem como lista com dois elementos (ex: [12, 50]) juntar
            if isinstance(valor_raw, list):
                try:
                    if len(valor_raw) >= 2:
                        valor_combined = f"{valor_raw[0]}.{valor_raw[1]}"
                        valor = _parse_numeric_value(valor_combined)
                    else:
                        valor = _parse_numeric_value(valor_raw[0])
                except Exception:
                    valor = None
            else:
                try:
                    valor = _parse_numeric_value(valor_raw)
                except Exception:
                    valor = None

            # categoria e observacao
            categoria = _normalize_category(params.get('Categoria') or params.get('Categoria1'))
            observacao = _first_from_param(params.get('Observacao') or params.get('observacao') or "")
            if isinstance(observacao, list):
                observacao = observacao[0] if observacao else ""
            if observacao and isinstance(observacao, str) and observacao.startswith(','):
                observacao = observacao.lstrip(',').strip()
                if observacao.isdigit():
                    observacao = ""

            if categoria == "Desconhecida":
                categoria = "Outros"

            # Validar valor
            if valor is None:
                logger.warning("Valor não identificado; solicitando confirmação ao usuário")
                return {'fulfillmentText': 'Não consegui identificar o valor. Pode repetir em números (ex: 50 ou 50.00)?'}

            # Define tipo (simples heurística)
            tipo = "Receita" if categoria.lower() in ['receita', 'salário', 'pix', 'renda', 'investimentos'] else "Despesa"

            # formata e registra via append_to_sheets
            try:
                data_atual = datetime.now(BRASILIA_TZ).strftime('%d/%m/%Y %H:%M:%S')
            except Exception:
                # se BRASILIA_TZ não existir, usa datetime local
                data_atual = datetime.now().strftime('%d/%m/%Y %H:%M:%S')

            # busca spreadsheet do contato
            spreadsheet_id = get_spreadsheet_id_for_contact(contact_number)
            if not spreadsheet_id:
                logger.error("Planilha não encontrada para o contato")
                return {'fulfillmentText': '⚠️ Erro ao acessar a planilha. Tente novamente mais tarde.'}

            # chamada a append_to_sheets - espera (success, saldo) ou boolean
            try:
                result = append_to_sheets(
                    data=data_atual,
                    categoria=categoria,
                    valor=valor,
                    observacao=(observacao or "")[:200],
                    spreadsheet_id=spreadsheet_id,
                    contact_number=contact_number,
                    tipo=tipo,
                    recorrente="Não",
                    parcela=""
                )
            except Exception as e:
                logger.error(f"Erro ao executar append_to_sheets: {e}")
                return {'fulfillmentText': '⚠️ Falha ao salvar o registro. Tente novamente mais tarde.'}

            # normalizar retorno
            if isinstance(result, tuple) and len(result) == 2:
                success, saldo_acumulado = result
            else:
                success = bool(result)
                saldo_acumulado = 0.0
                if success:
                    logger.warning("append_to_sheets retornou booleano. Recomenda-se atualizar para (success, saldo).")

            if success:
                if tipo == "Receita":
                    resposta = (
                        "🎉 *Receita Registrada com Sucesso!* 🎉\n\n"
                        f"📅 *Data*: {data_atual}\n"
                        f"📂 *Categoria*: {categoria}\n"
                        f"💰 *Valor*: R$ {valor:.2f}\n"
                        f"📝 *Observação*: {observacao or 'Nenhuma'}\n\n"
                        f"💵 *Saldo Total*: R$ {saldo_acumulado:.2f}"
                    )
                else:
                    resposta = (
                        "✅ *Despesa Registrada com Sucesso!* ✅\n\n"
                        f"📅 *Data*: {data_atual}\n"
                        f"📂 *Categoria*: {categoria}\n"
                        f"💰 *Valor*: R$ {valor:.2f}\n"
                        f"📝 *Observação*: {observacao or 'Nenhuma'}\n\n"
                        f"💵 *Saldo Atualizado*: R$ {saldo_acumulado:.2f}"
                    )
            else:
                resposta = "⚠️ Erro ao salvar registro. Tente novamente mais tarde. 😓"

            return {'fulfillmentText': resposta}

        # --- Aqui podem entrar outros intents: exemplo rápido 'consultar saldo' --- #
        if intent_lower == 'consultar saldo':
            try:
                spreadsheet_id = get_spreadsheet_id_for_contact(contact_number)
                if not spreadsheet_id:
                    return {'fulfillmentText': 'Não encontrei a planilha do seu contato.'}
                # Implementar função que lê saldo (ex: read_balance_from_sheet)
                saldo = read_balance_from_sheet(spreadsheet_id) if 'read_balance_from_sheet' in globals() else None
                if saldo is None:
                    return {'fulfillmentText': 'Não foi possível obter o saldo agora.'}
                return {'fulfillmentText': f"💰 Seu saldo atual é R$ {saldo:.2f}"}
            except Exception as e:
                logger.error(f"Erro ao consultar saldo: {e}")
                return {'fulfillmentText': 'Erro ao consultar saldo. Tente novamente.'}

        # --- Default: intent não tratada explicitamente ---
        logger.info(f"Intent '{intent}' não mapeada para ação automática. Retornando fulfillment padrão.")
        # Se o Dialogflow já forneceu um fulfillmentText, retorna-o
        fulfillment = query_result.get('fulfillmentText') or query_result.get('responseText') or "Desculpe, não entendi. Pode reformular?"
        return {'fulfillmentText': fulfillment}

    except Exception as e:
        logger.exception(f"Erro crítico em handle_dialogflow_response: {e}")
        return {'fulfillmentText': '⚠️ Erro interno. Tente novamente mais tarde.'}
            
### SEÇÃO 8.2: FUNÇÕES DE IA E HISTÓRICO ###
import openai
from supabase import create_client, Client
import json
import re
from datetime import datetime

# Configurações da OpenAI
openai.api_key = os.getenv('OPENAI_API_KEY')

# Configurações do Supabase
supabase_url = os.getenv('SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_KEY')
supabase = create_client(supabase_url, supabase_key) if supabase_url and supabase_key else None

# --- Funções Auxiliares --- #
def _safe_parse_number(value):
    """Tenta extrair um número de uma string (ex.: 'R$ 1.234,56' ou '1234.56')."""
    if value is None or not isinstance(value, (str, int, float)):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    
    s = str(value).strip().lower()
    # Normaliza moeda brasileira: remove 'r$', substitui ',' por '.', remove separadores de milhar
    s = re.sub(r'[^\d,.]', '', s)  # Remove tudo exceto dígitos, ponto e vírgula
    s = re.sub(r'\.(?=\d{3})', '', s)  # Remove pontos de milhar (ex.: 1.234,56 → 1234,56)
    s = s.replace(',', '.')  # Substitui vírgula por ponto
    # Extrai o primeiro número válido
    m = re.search(r'-?\d+\.?\d*', s)
    if not m:
        return None
    try:
        return float(m.group())
    except ValueError:
        return None

def _ensure_openai_key():
    """Verifica se a chave da OpenAI está configurada."""
    if not openai.api_key:
        logger.warning("OpenAI não configurada")
        return False
    return True

# --- Histórico (Supabase) --- #
def buscar_historico_ia(phone_number: str, limit: int = 5) -> list:
    """Busca as últimas mensagens no Supabase para fornecer contexto à IA."""
    try:
        if not supabase:
            logger.warning("Supabase não configurado")
            return []
        
        # Sanitiza o número de telefone
        phone_number = re.sub(r'[^0-9+]', '', phone_number)
        response = supabase.table('historico_conversas') \
            .select('*') \
            .eq('phone_number', phone_number) \
            .order('created_at', desc=True) \
            .limit(limit) \
            .execute()
        
        return response.data if response and response.data else []
    except Exception as e:
        logger.error(f"Erro ao buscar histórico para {phone_number}: {str(e)}")
        return []

def salvar_historico_ia(phone_number: str, user_message: str, ai_response: str) -> bool:
    """Salva a interação no Supabase (limita tamanho das mensagens)."""
    try:
        if not supabase:
            logger.warning("Supabase não configurado")
            return False
        
        # Sanitiza o número e limita mensagens
        phone_number = re.sub(r'[^0-9+]', '', phone_number)
        user_message = (user_message or "").strip()[:500]
        ai_response = (ai_response or "").strip()[:500]
        
        data = {
            "phone_number": phone_number,
            "user_message": user_message,
            "ai_response": ai_response
        }
        
        supabase.table('historico_conversas').insert(data).execute()
        logger.info(f"Histórico salvo para {phone_number}")
        return True
    except Exception as e:
        logger.error(f"Erro ao salvar histórico para {phone_number}: {str(e)}")
        return False

# --- Geração de resposta com IA ---
def gerar_resposta_ia(mensagem_usuario: str, historico: list) -> str | None:
    """Gera resposta usando OpenAI (chat) com contexto do histórico."""
    try:
        if not _ensure_openai_key():
            return None

        from openai import OpenAI
        import os

        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        system_prompt = (
            "Você é o Finax, assistente financeiro brasileiro prático. "
            "Ajude a registrar gastos e receitas, dar dicas e gerar relatórios. "
            "Seja conciso, responda em português e use poucos emojis. "
            "Sugira confirmação para registros (ex.: 'Confirme com Sim/Não')."
        )

        messages = [{"role": "system", "content": system_prompt}]

        # Limita histórico
        historico_size = sum(len(str(msg.get('user_message', ''))) + len(str(msg.get('ai_response', ''))) for msg in historico[-3:])
        max_tokens = max(150, 250 - (historico_size // 10))

        for msg in historico[-3:]:
            user_msg = str(msg.get('user_message') or "").strip()[:200]
            ai_msg = str(msg.get('ai_response') or "").strip()[:200]
            if user_msg:
                messages.append({"role": "user", "content": user_msg})
            if ai_msg:
                messages.append({"role": "assistant", "content": ai_msg})

        messages.append({"role": "user", "content": mensagem_usuario})

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_completion_tokens=max_tokens,
            temperature=0.7
        )

        return response.choices[0].message.content.strip()

    except Exception as e:
        logger.exception(f"Erro ao gerar resposta IA para mensagem: {str(e)}")
        return None

# --- Extração de entidades --- #
def extrair_entidades_ia(mensagem: str) -> dict:
    """Extrai 'valor', 'categoria' e 'tipo' usando a OpenAI."""
    try:
        if not _ensure_openai_key():
            return {"valor": None, "categoria": "Outros", "tipo": "despesa"}

        prompt = f'''
Extraia informações financeiras desta mensagem em português: "{mensagem}"

Retorne APENAS um objeto JSON com as chaves:
- "valor": número (ex: 150.50) ou null
- "categoria": string (ex: "Alimentação", "Transporte", "Salário")
- "tipo": "despesa" ou "receita"

Exemplos:
- "Gastei 50 no mercado" → {{"valor": 50.0, "categoria": "Alimentação", "tipo": "despesa"}}
- "Recebi 2000 de salário" → {{"valor": 2000.0, "categoria": "Salário", "tipo": "receita"}}
- "Oi, tudo bem?" → {{"valor": null, "categoria": "Outros", "tipo": "despesa"}}

Se não houver informação clara, retorne:
{{"valor": null, "categoria": "Outros", "tipo": "despesa"}}
'''

        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=150,
            temperature=0.1
        )

        resposta = response.choices[0].message.get('content', '').strip()

        # Tenta carregar JSON
        try:
            dados = json.loads(resposta)
        except json.JSONDecodeError:
            # Fallback com regex para JSON embutido
            m = re.search(r'\{[\s\S]*\}', resposta)
            if m:
                try:
                    dados = json.loads(m.group())
                except Exception:
                    dados = None
            else:
                dados = None

        if not isinstance(dados, dict) or 'valor' not in dados or 'categoria' not in dados or 'tipo' not in dados:
            logger.warning(f"JSON inválido ou incompleto na extração: {resposta}")
            return {"valor": None, "categoria": "Outros", "tipo": "despesa"}

        # Validações adicionais
        valor = _safe_parse_number(dados.get('valor'))
        categoria = str(dados.get('categoria', 'Outros')).strip() or 'Outros'
        tipo = str(dados.get('tipo', 'despesa')).lower()
        tipo = 'receita' if tipo == 'receita' else 'despesa'

        return {
            "valor": round(float(valor), 2) if valor else None,
            "categoria": categoria,
            "tipo": tipo
        }

    except Exception as e:
        logger.error(f"Erro ao extrair entidades de '{mensagem}': {str(e)}")
        return {"valor": None, "categoria": "Outros", "tipo": "despesa"}

# --- Processamento e registro automático --- #
def processar_com_ia(contact_number: str, user_message: str) -> str | None:
    """Processa a mensagem com IA. Se identificar um gasto/receita, registra automaticamente."""
    try:
        historico = buscar_historico_ia(contact_number)
        resposta_ia = gerar_resposta_ia(user_message, historico)
        
        if not resposta_ia:
            return None

        # Salva histórico
        salvar_historico_ia(contact_number, user_message, resposta_ia)

        # Verifica se é uma mensagem financeira
        palavras_chave = [
            'gastei', 'paguei', 'comprei', 'recebi', 'gasto', 'pago', 'valor', 
            'custo', 'preço', 'r$', 'reais', 'investi', 'ganhei', 'entrou'
        ]
        
        if any(palavra in user_message.lower() for palavra in palavras_chave):
            dados = extrair_entidades_ia(user_message)
            if dados and dados.get('valor') is not None:
                resposta_completa = registrar_e_responder(contact_number, user_message, dados, resposta_ia)
                return resposta_completa

        return resposta_ia
    except Exception as e:
        logger.error(f"Erro no processamento com IA para {contact_number}: {str(e)}")
        return None

def registrar_e_responder(contact_number: str, user_message: str, dados: dict, resposta_ia: str) -> str:
    """Registra o movimento no Google Sheets e retorna a mensagem final para o usuário."""
    try:
        data_atual = datetime.now(BRASILIA_TZ).strftime('%d/%m/%Y %H:%M:%S')
        spreadsheet_id = get_spreadsheet_id_for_contact(contact_number)
        
        if not spreadsheet_id:
            return resposta_ia

        # Determina o tipo (despesa ou receita)
        tipo = dados.get('tipo', 'despesa').capitalize()
        if tipo not in ['Despesa', 'Receita']:
            tipo = 'Receita' if any(p in user_message.lower() for p in ['recebi', 'ganhei', 'salário', 'renda']) else 'Despesa'

        # Converte o valor
        try:
            valor_float = float(dados['valor'])
            if valor_float <= 0:
                logger.warning(f"Valor zero ou negativo ignorado para {contact_number}: {valor_float}")
                return resposta_ia
        except (ValueError, TypeError):
            logger.error(f"Valor inválido para registro automático para {contact_number}: {dados.get('valor')}")
            return resposta_ia

        # Registra na planilha
        success, saldo = append_to_sheets(
            data=data_atual,
            categoria=dados.get('categoria', 'Outros'),
            valor=valor_float,
            observacao=user_message[:100],
            spreadsheet_id=spreadsheet_id,
            contact_number=contact_number,
            tipo=tipo
        )

        if success:
            return (
                f"{resposta_ia}\n\n"
                f"💾 *Registrado automaticamente:* {dados.get('categoria', 'Outros')} - R$ {valor_float:.2f} ({tipo})\n"
                f"💰 *Saldo atual:* R$ {saldo:.2f}"
            )

        return resposta_ia

    except Exception as e:
        logger.error(f"Erro ao registrar automaticamente para {contact_number}: {str(e)}")
        return resposta_ia

# === SEÇÃO 8.3: PROCESSAMENTO PRINCIPAL COM IA ===
import time
from typing import Dict, Any

def handle_dialogflow_response(query_result: Dict[str, Any], contact_number: str, message_id: str, user_message: str) -> Dict[str, Any]:
    """
    Fluxo principal de processamento de mensagem:
    1) Deduplicação (MessageSid ou conteúdo)
    2) Tenta processar com IA (processar_com_ia)
    3) Se falhar, fallback para Dialogflow (handle_dialogflow_response_fallback)
    Retorna um dicionário com a chave 'fulfillmentText'.
    """
    start_time = time.time()

    # Garante que os dicionários de dedupe existem no escopo global
    global processed_messages, processed_by_content
    if 'processed_messages' not in globals():
        processed_messages = {}
    if 'processed_by_content' not in globals():
        processed_by_content = {}

    try:
        # Normaliza entradas
        contact_number = (contact_number or "").strip()
        user_message = (user_message or "").strip()
        message_id = message_id or ""  # pode ser vazio

        if not contact_number:
            logger.error("Contato ausente em handle_dialogflow_response")
            return {'fulfillmentText': '⚠️ Número do contato ausente.'}

        now = time.time()

        # 1) Checa duplicatas por message_id (se presente)
        if message_id:
            last = processed_messages.get(message_id)
            if last:
                elapsed = now - last
                logger.warning(f"⚠️ Mensagem duplicada detectada por MessageSid: {message_id} (há {elapsed:.2f}s).")
                return {'fulfillmentText': 'Mensagem já processada anteriormente.'}

        # 2) Checa duplicatas por conteúdo (contact + message)
        content_key = f"{contact_number}:{user_message}"
        last_content = processed_by_content.get(content_key)
        if last_content and (now - last_content) < 10:  # 10s janela
            elapsed = now - last_content
            logger.warning(f"⚠️ Mensagem duplicada detectada por conteúdo: {content_key} (há {elapsed:.2f}s).")
            return {'fulfillmentText': 'Mensagem já processada anteriormente.'}

        # 3) Registra como processada (antes de executar para evitar race conditions)
        if message_id:
            processed_messages[message_id] = now
        processed_by_content[content_key] = now

        # 4) Limpeza de entradas antigas (segurança contra crescimento infinito)
        cutoff = now - (5 * 60)  # 5 minutos
        for mid, ts in list(processed_messages.items()):
            if ts < cutoff:
                processed_messages.pop(mid, None)
        for ck, ts in list(processed_by_content.items()):
            if ts < cutoff:
                processed_by_content.pop(ck, None)

        logger.info(f"Dedup state: {len(processed_messages)} ids, {len(processed_by_content)} conteúdos.")

        # 5) Tenta processar com IA (se configurada)
        try:
            openai_configured = bool(getattr(openai, "api_key", None))
        except Exception:
            openai_configured = False

        supabase_configured = bool(globals().get('supabase_url')) and bool(globals().get('supabase_key'))

        if openai_configured and supabase_configured:
            try:
                resposta_ia = processar_com_ia(contact_number, user_message)
                if resposta_ia:
                    elapsed = time.time() - start_time
                    logger.info(f"Resposta gerada por IA em {elapsed:.2f}s para {contact_number}")
                    return {'fulfillmentText': resposta_ia}
                else:
                    logger.info("IA não gerou resposta aplicável; seguindo para fallback Dialogflow.")
            except Exception as e:
                logger.error(f"Erro ao processar com IA (continuando com fallback): {e}")

        else:
            logger.info("OpenAI ou Supabase não configurados — pulando processamento por IA.")

        # 6) FALLBACK: usa lógica do Dialogflow (função separada)
        try:
            # Espera-se que exista uma função handle_dialogflow_response_fallback definida em outra seção.
            if 'handle_dialogflow_response_fallback' in globals():
                return handle_dialogflow_response_fallback(query_result, contact_number, message_id, user_message)
            else:
                logger.error("handle_dialogflow_response_fallback não encontrada no escopo.")
                return {'fulfillmentText': '⚠️ Serviço indisponível no momento.'}
        except Exception as e:
            logger.exception(f"Erro no fallback Dialogflow: {e}")
            return {'fulfillmentText': '⚠️ Erro interno no processamento. Tente novamente mais tarde.'}

    except Exception as e:
        logger.exception(f"Erro crítico em handle_dialogflow_response: {e}")
        return {'fulfillmentText': '⚠️ Erro interno. Tente novamente mais tarde.'}
def handle_dialogflow_response_fallback(query_result, contact_number, message_id, user_message):
    """Processamento original com Dialogflow (fallback) — versão corrigida e mais robusta."""
    try:
        # --- helpers internos ---
        import re
        def _first(value):
            if value is None: 
                return None
            if isinstance(value, list):
                return value[0] if value else None
            return value

        def _parse_number(raw):
            """Tenta converter vários formatos ('R$ 1.234,56', '1234.56', dict{'amount':..}, list, etc.) -> float ou raise."""
            if raw is None:
                raise ValueError("valor nulo")
            if isinstance(raw, (int, float)):
                return float(raw)
            if isinstance(raw, dict) and 'amount' in raw:
                return float(raw['amount'])
            s = str(raw).strip()
            # remove não-dígitos exceto , . e -
            s = s.replace("R$", "").replace("r$", "").replace(" ", "")
            # se tiver ponto e vírgula (padrão BR) transforma: 1.234,56 -> 1234.56
            if s.count(",") >= 1 and s.count(".") >= 1:
                s = s.replace(".", "").replace(",", ".")
            else:
                s = s.replace(",", ".")
            m = re.search(r"-?\d+(\.\d+)?", s)
            if not m:
                raise ValueError(f"Formato numérico inválido: {raw}")
            return float(m.group())

        def _get_output_contexts(qr):
            return qr.get('outputContexts', []) or []

        def _context_has_name(qr, name_suffix):
            for ctx in _get_output_contexts(qr):
                name = ctx.get('name') or ""
                if name.endswith('/' + name_suffix) or name.split('/')[-1] == name_suffix:
                    return True
            return False

        # --- início do processamento ---
        intent = (query_result.get('intent') or {}).get('displayName', '') or ''
        params = query_result.get('parameters') or {}
        query_text = (query_result.get('queryText') or user_message or "").lower()

        if not intent:
            logger.warning("Intent não identificada no fallback Dialogflow")
            return {'fulfillmentText': '⚠️ Intent não identificada. Pode repetir?'}

        intent_lower = intent.lower()

        # ——————— Gerar Relatório ———————
        if intent_lower == 'gerar relatório':
            periodo_param = _first(params.get('periodo') or params.get('Periodo'))
            periodo = (periodo_param or "Semanal").capitalize()
            # se o usuário mencionou "atual" no texto, prioriza semana atual
            if 'atual' in (user_message or "").lower():
                generate_current_week_summary(contact_number)
                return {'fulfillmentText': "📊 Seu resumo da *semana atual* está sendo gerado e logo chega no seu WhatsApp! 😉"}
            generate_report(contact_number, periodo)
            return {'fulfillmentText': f"📊 Seu relatório *{periodo.lower()}* está sendo gerado e logo chega no seu WhatsApp! 😉"}

        # Detecta indicativo de parcelamento no texto para redirecionar
        if intent_lower == 'registrar gastos' and any(token in query_text for token in ['em x', ' x ', 'x de', 'dividido em', 'parcelas', 'parcelamento']):
            intent_lower = 'registrar gasto recorrente'
            logger.info("📋 Redirecionado Registrar Gastos → Registrar Gasto Recorrente por indicação de parcelamento")

        # Verifica se réponse é atualização de diadomes via contexto
        is_diadomes_update = _context_has_name(query_result, 'awaiting_diadomes') or ('dia' in query_text and 'diadomes' in query_text) 

        # ——————— Registrar gasto recorrente ———————
        if intent_lower == 'registrar gasto recorrente':
            # categoria (pode vir como lista)
            categoria_info = params.get('categoria') or params.get('Categoria') or ['Gastos Fixos']
            categoria = _first(categoria_info) or "Gastos Fixos"

            # tenta obter categoria_original de contextos (parâmetros)
            categoria_original = None
            for ctx in _get_output_contexts(query_result):
                # procura parâmetro 'categoria.original' de forma segura
                params_ctx = ctx.get('parameters') or {}
                co = params_ctx.get('categoria.original') or params_ctx.get('categoria_original') or params_ctx.get('categoria.original.value')
                if co:
                    categoria_original = _first(co)
                    break
            if not categoria_original:
                # fallback para usar parte do texto da query
                if ' de ' in query_text:
                    categoria_original = query_text.split(' de ')[-1].strip()
                else:
                    categoria_original = query_text.strip() or "Sem descrição"

            # extrai valores e parâmetros
            raw_val = params.get('valor-monetario') or params.get('valor') or params.get('Valor') or params.get('amount')
            raw_val = _first(raw_val)
            raw_periodicidade = _first(params.get('periodicidade') or params.get('periodicidadeTexto') or "")
            raw_dia_semana = _first(params.get('diadasemana') or params.get('diadasemana') or "")
            raw_dia_mes = _first(params.get('diadomes') or params.get('diadomes') or params.get('diadomês'))
            raw_num_parcelas = _first(params.get('numdeparcelas') or params.get('numdeparcelas') or params.get('parcelas'))

            # normaliza periodicidade
            periodicidade = (str(raw_periodicidade or "")).strip().lower()
            dia_semana = (str(raw_dia_semana).strip() or None)
            dia_mes = (str(raw_dia_mes).strip() or None)
            num_parcelas = _first(raw_num_parcelas)

            # determina tipo_recorrencia
            if periodicidade in ["diária", "diario", "todo dia", "todos os dias", "diaria"]:
                tipo_recorrencia = "Diária"
            elif periodicidade in ["semanal", "toda semana", "semanalmente"]:
                tipo_recorrencia = "Semanal"
            elif periodicidade in ["mensal", "todo mês", "todo mes", "mensalmente"]:
                tipo_recorrencia = "Mensal"
            elif ("x" in str(periodicidade)) or ("parcelas" in str(periodicidade)) or bool(num_parcelas):
                tipo_recorrencia = "Parcelamento Fixo"
            else:
                tipo_recorrencia = "Mensal"

            # val validations: valor obrigatório
            try:
                valor = _parse_number(raw_val)
            except Exception:
                logger.error(f"Valor inválido recebido para gasto recorrente: {raw_val}")
                return {'fulfillmentText': '⚠️ Valor inválido. Informe um número válido (ex.: 800 ou 800.00).'}

            if tipo_recorrencia == "Parcelamento Fixo" and (not num_parcelas):
                return {'fulfillmentText': '⚠️ Informe o número de parcelas para parcelamento fixo.'}
            if tipo_recorrencia == "Semanal" and not dia_semana:
                return {'fulfillmentText': '⚠️ Informe o dia da semana para gastos semanais.'}

            # se dia do mês não informado, assume dia atual para mensal/parcelamento
            if tipo_recorrencia in ["Mensal", "Parcelamento Fixo"] and not dia_mes:
                try:
                    dia_mes = int(datetime.now(BRASILIA_TZ).day)
                except Exception:
                    dia_mes = int(datetime.now().day)
                logger.info(f"📋 Dia do mês não informado. Assumindo dia {dia_mes} como padrão.")

            # se foi detectado diadomes informando dia e tipo 'Diária', transforma para Mensal
            if tipo_recorrencia == "Diária" and dia_mes and not is_diadomes_update:
                tipo_recorrencia = "Mensal"
                logger.info("📋 Ajustado tipo de recorrência de Diária para Mensal por presença de dia do mês.")

            # obtem planilha
            spreadsheet_id = get_spreadsheet_id_for_contact(contact_number)
            if not spreadsheet_id:
                logger.error(f"Planilha não encontrada para {contact_number}")
                return {'fulfillmentText': '⚠️ Não foi possível encontrar sua planilha. Tente novamente.'}

            # tenta ler a aba Gastos Recorrentes (função get_sheet_data deve existir)
            recurring_data = []
            try:
                recurring_data = get_sheet_data(spreadsheet_id, 'Gastos Recorrentes!A:K') or []
            except Exception as e:
                logger.warning(f"Não foi possível obter dados de Gastos Recorrentes: {e}")
                recurring_data = []

            # Se for atualização de diadomes, procura último gasto correspondente e atualiza
            if is_diadomes_update and tipo_recorrencia in ["Mensal", "Parcelamento Fixo"] and recurring_data:
                last_row = None
                last_index = None
                for idx, row in enumerate(recurring_data):
                    # checa segurança: a linha pode ter menos colunas
                    try:
                        row_desc = row[0] if len(row) > 0 else ""
                        row_cat = row[1] if len(row) > 1 else ""
                        row_val = float(row[3]) if len(row) > 3 and str(row[3]).strip() != "" else None
                    except Exception:
                        row_val = None
                    if row_desc == categoria_original and row_cat == categoria and row_val == float(valor):
                        last_row = row
                        last_index = idx + 2  # A2 é linha 2 dos dados
                        break

                if last_row and last_index:
                    try:
                        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
                        # desativa gastos anteriores iguais
                        for idx, row in enumerate(recurring_data):
                            if len(row) >= 7:
                                try:
                                    r_desc = row[0]
                                    r_cat = row[1]
                                    r_val = float(row[3]) if row[3] != "" else None
                                    ativo = str(row[6]).strip().lower()
                                except Exception:
                                    continue
                                if r_desc == categoria_original and r_cat == categoria and r_val == float(valor) and ativo == "sim":
                                    row_index = idx + 2
                                    sheets_service.spreadsheets().values().update(
                                        spreadsheetId=spreadsheet_id,
                                        range=f'Gastos Recorrentes!G{row_index}',
                                        valueInputOption='RAW',
                                        body={'values': [["Não"]]}
                                    ).execute()
                        # atualiza o diadomes e garante que está ativo
                        last_row[9 if len(last_row) > 9 else -1] = str(dia_mes)
                        if len(last_row) > 6:
                            last_row[6] = "Sim"
                        update_sheet_data(spreadsheet_id, f'Gastos Recorrentes!A{last_index}:K{last_index}', [last_row])
                        logger.info(f"Gasto recorrente atualizado na linha {last_index}")
                        if tipo_recorrencia == "Parcelamento Fixo":
                            resposta = f"📦 Parcelamento atualizado: {categoria_original} em {num_parcelas}x de R$ {valor:.2f} ({categoria}) todo dia {dia_mes}."
                        else:
                            resposta = f"💡 Gasto mensal atualizado: {categoria_original} de R$ {valor:.2f} ({categoria}) todo dia {dia_mes}."
                        return {'fulfillmentText': resposta}
                    except Exception as e:
                        logger.error(f"Erro ao atualizar gasto recorrente: {e}")
                        return {'fulfillmentText': '⚠️ Falha ao atualizar gasto recorrente. Tente novamente.'}
                else:
                    return {'fulfillmentText': '⚠️ Não foi possível encontrar o gasto recorrente para atualizar.'}

            # Caso normal: registra novo gasto recorrente
            try:
                saved = save_recurring_expense(contact_number, categoria_original, categoria, valor, tipo_recorrencia, dia_semana, dia_mes, num_parcelas)
                if saved:
                    # se Parcelamento Fixo, retorna com contexto para coletar diadomes
                    if tipo_recorrencia == "Parcelamento Fixo":
                        resposta = (f"📦 Parcelamento configurado: {categoria_original} em {num_parcelas}x de R$ {valor:.2f} ({categoria}) todo dia {dia_mes}.")
                        return {
                            'fulfillmentText': resposta,
                            'outputContexts': [
                                {
                                    'name': f'projects/gestorfinanceiro-cihl/agent/sessions/{contact_number}/contexts/awaiting_diadomes',
                                    'lifespanCount': 1,
                                    'parameters': {
                                        'categoria': categoria,
                                        'categoria.original': categoria_original,
                                        'valor-monetario': valor,
                                        'numdeparcelas': num_parcelas,
                                        'tipo_recorrencia': tipo_recorrencia
                                    }
                                },
                                {
                                    'name': f'projects/gestorfinanceiro-cihl/agent/sessions/{contact_number}/contexts/informar_diadomes_event',
                                    'lifespanCount': 1
                                }
                            ]
                        }
                    elif tipo_recorrencia == "Semanal":
                        resposta = f"💡 Gasto semanal configurado: {categoria_original} de R$ {valor:.2f} ({categoria}) toda {dia_semana}."
                    elif tipo_recorrencia == "Mensal":
                        resposta = f"💡 Gasto mensal configurado: {categoria_original} de R$ {valor:.2f} ({categoria}) todo dia {dia_mes}."
                    else:
                        resposta = f"💡 Gasto diário configurado: {categoria_original} de R$ {valor:.2f} ({categoria})."
                    return {'fulfillmentText': resposta}
                else:
                    return {'fulfillmentText': '⚠️ Erro ao configurar o gasto recorrente. Tente novamente.'}
            except Exception as e:
                logger.error(f"Erro ao salvar gasto recorrente: {e}")
                return {'fulfillmentText': '⚠️ Erro ao configurar o gasto recorrente. Tente novamente.'}

        # se chegou aqui, intent não tratada por esse fallback — devolve fallback padrão do Dialogflow se existir
        fulfillment = query_result.get('fulfillmentText') or query_result.get('responseText') or "Desculpe, não entendi. Pode reformular?"
        return {'fulfillmentText': fulfillment}

    except Exception as e:
        logger.exception(f"Erro crítico no fallback Dialogflow: {e}")
        return {'fulfillmentText': '⚠️ Erro interno. Tente novamente mais tarde.'}


### SEÇÃO 8.3: PROCESSAMENTO PRINCIPAL COM IA ###
def handle_dialogflow_response(query_result, contact_number, message_id, user_message):
    """Processa a resposta com IA primeiro, fallback para Dialogflow."""
    start_time = time.time()

    try:
        # Verificação de duplicatas
        current_time = time.time()
        if message_id in processed_messages:
            last_processed_time = processed_messages[message_id]
            time_diff = current_time - last_processed_time
            logger.warning(f"⚠️ Mensagem duplicada detectada (MessageSid): {message_id}. "
                           f"Tempo desde o último processamento: {time_diff:.2f} segundos")
            return {'fulfillmentText': 'Mensagem já processada anteriormente.'}

        # Verifica duplicatas por conteúdo
        content_key = f"{contact_number}:{user_message}"
        if content_key in processed_by_content:
            last_processed_time = processed_by_content[content_key]
            time_diff = current_time - last_processed_time
            if time_diff < 10:  # 10 segundos de intervalo
                logger.warning(f"⚠️ Mensagem duplicada detectada (conteúdo): {content_key}. "
                               f"Tempo desde o último processamento: {time_diff:.2f} segundos")
                return {'fulfillmentText': 'Mensagem já processada anteriormente.'}

        # Adiciona às mensagens processadas
        processed_messages[message_id] = current_time
        processed_by_content[content_key] = current_time

        # Limpa mensagens antigas (mais de 5 minutos)
        cutoff_time = current_time - (5 * 60)
        for msg_id, timestamp in list(processed_messages.items()):
            if timestamp < cutoff_time:
                del processed_messages[msg_id]
        for key, timestamp in list(processed_by_content.items()):
            if timestamp < cutoff_time:
                del processed_by_content[key]

        # PRIMEIRO: Tenta processar com IA se estiver configurada
        if openai.api_key and supabase_url and supabase_key:
            resposta_ia = processar_com_ia(contact_number, user_message)
            if resposta_ia:
                logger.info(f"🤖 Resposta IA gerada em {time.time() - start_time:.2f}s")
                return {'fulfillmentText': resposta_ia}

        # FALLBACK: Se a IA falhar ou não estiver configurada, usa o Dialogflow
        logger.info("🔁 Usando fallback para Dialogflow")
        return handle_dialogflow_response_fallback(query_result, contact_number, message_id, user_message)

    except Exception as e:
        logger.error(f"🤖 Erro no processamento do handle_dialogflow_response: {str(e)}")
        return {'fulfillmentText': '⚠️ Ocorreu um erro ao processar sua solicitação. Tente novamente.'}
    finally:
        logger.info(f"⏱️ Tempo para handle_dialogflow_response: {time.time() - start_time:.2f} segundos")


def handle_dialogflow_response_fallback(query_result, contact_number, message_id, user_message):
    """Processamento original com Dialogflow (fallback)"""
    try:
        intent = query_result.get('intent', {}).get('displayName', '')
        params = query_result.get('parameters', {})

        if not intent:
            raise ValueError("Intent não identificada")

        # Normaliza a intent
        intent_lower = intent.lower()

        # ——————— Registrar gastos avulsos ———————
        if intent_lower == 'registrar gastos':
            # Extrai os parâmetros
            valor = params.get('valor', [0])
            categoria = params.get('Categoria1', ['Outros'])[0]
            observacao = params.get('Observacao', '')

            # Log dos parâmetros recebidos
            logger.info(f"📋 Parâmetros recebidos - Valor: {valor}, Categoria: {categoria}, Observacao: {observacao}")

            # Normaliza o valor
            if isinstance(valor, list):
                if len(valor) > 1:
                    logger.warning(f"⚠️ Múltiplos valores detectados: {valor}. Tentando combinar como número decimal.")
                    try:
                        valor = float(".".join(map(str, valor)))
                    except ValueError:
                        valor = float(valor[0])
                else:
                    valor = float(valor[0] if valor else 0)
            else:
                valor = float(valor)

            # Obtém a planilha do contato
            spreadsheet_id = get_spreadsheet_id_for_contact(contact_number)
            if not spreadsheet_id:
                logger.error(f"🔥 Não foi possível obter a planilha para {contact_number}")
                return {'fulfillmentText': '⚠️ Não foi possível encontrar sua planilha. Tente novamente.'}

            # Registra o gasto na aba mensal
            today = datetime.now(BRASILIA_TZ)
            today_str = today.strftime('%d/%m/%Y %H:%M:%S')
            success, saldo_acumulado = append_to_sheets(
                data=today_str,
                categoria=categoria,
                valor=valor,
                observacao=observacao,
                spreadsheet_id=spreadsheet_id,
                contact_number=contact_number,
                tipo="Despesa",
                recorrente="Não"
            )

            if success:
                resposta = f"📊 Gasto registrado: {categoria} - R$ {valor:.2f}. Saldo acumulado: R$ {saldo_acumulado:.2f}."
                return {'fulfillmentText': resposta}
            else:
                return {'fulfillmentText': '⚠️ Erro ao registrar o gasto. Tente novamente.'}

        else:
            return {'fulfillmentText': '⚠️ Intent não reconhecida. Tente novamente.'}

    except Exception as e:
        logger.error(f"🤖 Erro no processamento do Dialogflow fallback: {str(e)}")
        return {'fulfillmentText': '⚠️ Ocorreu um erro ao processar sua solicitação. Tente novamente.'}
        
### SEÇÃO 8.1: FUNÇÕES PARA GERENCIAR GASTOS RECORRENTES ###

def save_recurring_expense(contact_number, descricao, categoria, valor, tipo_recorrencia, dia_semana=None, dia_mes=None, num_parcelas=None):
    """Salva um novo gasto recorrente na aba 'Gastos Recorrentes'."""
    start_time = time.time()
    try:
        # Valida os parâmetros
        if not contact_number or not valor:
            logger.error(f"🔥 Parâmetros inválidos: contact_number={contact_number}, valor={valor}")
            return False
        
        # Converte o valor para float
        try:
            valor_float = float(valor)
        except (ValueError, TypeError):
            logger.error(f"🔥 Valor inválido: {valor}")
            return False

        # Obtém a planilha do contato
        spreadsheet_id = get_spreadsheet_id_for_contact(contact_number)
        if not spreadsheet_id:
            logger.error(f"🔥 Não foi possível obter a planilha para {contact_number}")
            return False

        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)

        # Prepara os dados para inserção
        today = datetime.now(BRASILIA_TZ).strftime('%d/%m/%Y')
        
        # Calcula o valor da parcela e o valor total
        valor_parcela = valor_float
        valor_total = valor_float
        parcela_atual = ""
        num_parcelas_str = ""
        
        if tipo_recorrencia == "Parcelamento Fixo" and num_parcelas:
            try:
                num_parcelas_int = int(float(num_parcelas))
                valor_parcela = valor_float
                valor_total = valor_float * num_parcelas_int
                parcela_atual = "1"
                num_parcelas_str = str(num_parcelas_int)
            except (ValueError, TypeError):
                logger.error(f"🔥 Número de parcelas inválido: {num_parcelas}")
                return False

        values = [[
            descricao,              # A: Descrição
            categoria,              # B: Categoria
            f"{valor_total:.2f}",   # C: Valor Total
            f"{valor_parcela:.2f}", # D: Valor da Parcela
            parcela_atual,          # E: Parcela Atual
            today,                  # F: Data Início
            "Sim",                  # G: Ativo
            tipo_recorrencia,       # H: Tipo de Recorrência
            dia_semana or "",       # I: Dia da Semana
            dia_mes or "",          # J: Dia do Mês
            num_parcelas_str        # K: Número de Parcelas
        ]]

        # Insere na aba "Gastos Recorrentes"
        sheets_service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range='Gastos Recorrentes!A2:K',
            valueInputOption='USER_ENTERED',  # Alterado para USER_ENTERED para melhor formatação
            body={'values': values}
        ).execute()

        logger.info(f"✅ Gasto recorrente salvo para {contact_number}: {descricao}, {tipo_recorrencia}, R${valor_float:.2f}")
        return True

    except Exception as e:
        logger.error(f"🔥 Erro ao salvar gasto recorrente para {contact_number}: {str(e)}")
        return False
    finally:
        logger.info(f"⏱️ Tempo para save_recurring_expense: {time.time() - start_time:.2f} segundos")

def process_recurring_expenses():
    """Processa todos os gastos recorrentes ativos e registra nas abas mensais."""
    start_time = time.time()
    try:
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)

        # Obtém todos os contatos da planilha de controle
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=CONTROL_SPREADSHEET_ID,
            range='Controle!A:B'
        ).execute()
        
        contacts = result.get('values', [])
        if len(contacts) <= 1:  # Verifica se há mais que apenas cabeçalho
            logger.info("📋 Nenhum contato encontrado para processar gastos recorrentes.")
            return
            
        contacts = contacts[1:]  # Pula o cabeçalho

        today = datetime.now(BRASILIA_TZ)
        today_str = today.strftime('%d/%m/%Y %H:%M:%S')
        today_day = today.day
        today_weekday = today.strftime('%A').lower()  # Ex.: "monday"

        for contact_row in contacts:
            if len(contact_row) < 2:
                continue
                
            contact_number, spreadsheet_id = contact_row
            logger.info(f"🔍 Processando gastos recorrentes para {contact_number}")

            # Obtém os dados da aba "Gastos Recorrentes"
            try:
                recurring_data = sheets_service.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id,
                    range='Gastos Recorrentes!A2:K'
                ).execute()
                recurring_values = recurring_data.get('values', [])
            except Exception as e:
                logger.error(f"🔥 Erro ao acessar gastos recorrentes para {contact_number}: {str(e)}")
                continue

            for row_index, row in enumerate(recurring_values):
                if len(row) < 11:
                    continue  # Ignora linhas incompletas

                # Desestrutura a linha
                descricao = row[0] if len(row) > 0 else ""
                categoria = row[1] if len(row) > 1 else ""
                valor_total = row[2] if len(row) > 2 else "0"
                valor_parcela = row[3] if len(row) > 3 else "0"
                parcela_atual = row[4] if len(row) > 4 else "1"
                data_inicio = row[5] if len(row) > 5 else ""
                ativo = row[6] if len(row) > 6 else "Não"
                tipo_recorrencia = row[7] if len(row) > 7 else ""
                dia_semana = row[8] if len(row) > 8 else ""
                dia_mes = row[9] if len(row) > 9 else ""
                num_parcelas = row[10] if len(row) > 10 else ""

                if ativo.lower() != "sim":
                    continue  # Pula se não estiver ativo

                try:
                    valor_parcela_float = float(valor_parcela.replace('R$', '').replace(',', '.')) if valor_parcela else 0
                    parcela_atual_int = int(parcela_atual) if parcela_atual and parcela_atual.isdigit() else 1
                    num_parcelas_int = int(num_parcelas) if num_parcelas and num_parcelas.isdigit() else 0
                except (ValueError, AttributeError) as e:
                    logger.error(f"🔥 Erro ao converter valores numéricos: {str(e)}")
                    continue

                should_process = False
                parcela_info = ""

                # Verifica se o gasto deve ser processado hoje
                if tipo_recorrencia == "Diária":
                    should_process = True
                elif tipo_recorrencia == "Semanal" and dia_semana:
                    should_process = today_weekday == dia_semana.lower()
                elif tipo_recorrencia == "Mensal" and dia_mes:
                    try:
                        should_process = today_day == int(dia_mes)
                    except ValueError:
                        logger.error(f"🔥 Dia do mês inválido: {dia_mes}")
                        continue
                elif tipo_recorrencia == "Parcelamento Fixo" and dia_mes and num_parcelas:
                    try:
                        should_process = (today_day == int(dia_mes) and parcela_atual_int <= num_parcelas_int)
                        parcela_info = f"{parcela_atual_int}/{num_parcelas_int}"
                    except ValueError:
                        logger.error(f"🔥 Valor inválido em parcelamento: dia_mes={dia_mes}, num_parcelas={num_parcelas}")
                        continue

                if should_process:
                    # Registra na aba mensal
                    success, saldo_acumulado = append_to_sheets(
                        data=today_str,
                        categoria=categoria,
                        valor=valor_parcela_float,
                        observacao=descricao,
                        spreadsheet_id=spreadsheet_id,
                        contact_number=contact_number,
                        tipo="Despesa",
                        recorrente="Sim",
                        parcela=parcela_info
                    )

                    if success:
                        logger.info(f"✅ Gasto recorrente registrado: {descricao} (R${valor_parcela_float}) para {contact_number}")
                        
                        # Atualiza a parcela atual para "Parcelamento Fixo"
                        if tipo_recorrencia == "Parcelamento Fixo":
                            new_parcela_atual = parcela_atual_int + 1
                            
                            # Atualiza a parcela atual
                            update_range = f'Gastos Recorrentes!E{row_index + 2}'  # +2 porque começa na linha 2
                            sheets_service.spreadsheets().values().update(
                                spreadsheetId=spreadsheet_id,
                                range=update_range,
                                valueInputOption='RAW',
                                body={'values': [[str(new_parcela_atual)]]}
                            ).execute()
                            
                            # Desativa se todas as parcelas foram pagas
                            if new_parcela_atual > num_parcelas_int:
                                update_range = f'Gastos Recorrentes!G{row_index + 2}'
                                sheets_service.spreadsheets().values().update(
                                    spreadsheetId=spreadsheet_id,
                                    range=update_range,
                                    valueInputOption='RAW',
                                    body={'values': [["Não"]]}
                                ).execute()
                                logger.info(f"✅ Gasto recorrente {descricao} concluído para {contact_number}")
                    else:
                        logger.error(f"🔥 Falha ao registrar gasto recorrente: {descricao} para {contact_number}")

        logger.info("✅ Processamento de gastos recorrentes concluído.")
    except Exception as e:
        logger.error(f"🔥 Erro ao processar gastos recorrentes: {str(e)}")
    finally:
        logger.info(f"⏱️ Tempo para process_recurring_expenses: {time.time() - start_time:.2f} segundos")

def get_sheet_data(spreadsheet_id, range_):
    """Obtém os dados de uma aba da planilha."""
    try:
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_
        ).execute()
        return result.get('values', [])
    except Exception as e:
        logger.error(f"🔥 Erro ao obter dados da planilha: {str(e)}")
        return []

def update_sheet_data(spreadsheet_id, range_, values):
    """Atualiza uma linha na aba especificada da planilha."""
    try:
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_,
            valueInputOption='RAW',
            body={'values': values}
        ).execute()
        logger.info(f"✅ Linha atualizada na planilha: {range_}")
        return True
    except Exception as e:
        logger.error(f"🔥 Erro ao atualizar linha na planilha: {str(e)}")
        return False

### SEÇÃO 9: ROTAS PRINCIPAIS ###
@app.route('/', methods=['GET'])
def health_check():
    """Endpoint de verificação de saúde"""
    # Verifica status dos serviços
    services_status = {
        'Dialogflow': True,
        'Sheets': True,
        'Twilio': True if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN else False,
        'OpenAI': True if openai.api_key else False,
        'Supabase': True if supabase_url and supabase_key else False
    }
    
    return jsonify({
        'status': 'online',
        'version': '1.0',
        'services': services_status,
        'timestamp': datetime.now(BRASILIA_TZ).isoformat()
    }), 200

@app.route('/', methods=['POST'])
def webhook():
    """Endpoint principal para webhook"""
    global DIALOGFLOW_TOKEN  # Permite modificar a variável global
    start_time = time.time()
    try:
        # Loga todas as requisições recebidas
        logger.info(f"📥 Requisição recebida - Headers: {dict(request.headers)}")
        
        # Atualiza token se necessário
        if credentials.expired:
            credentials.refresh(Request())
            DIALOGFLOW_TOKEN = credentials.token  # Atualiza o token global
            logger.info("🔄 Token de acesso atualizado")

        # Processa requisição do Twilio
        if 'application/x-www-form-urlencoded' in request.headers.get('Content-Type', ''):
            logger.info(f"📥 Dados recebidos do Twilio: {dict(request.form)}")
            
            # Extrai dados do Twilio
            user_number = request.form.get('From', '')
            user_message = request.form.get('Body', '')
            message_id = request.form.get('MessageSid', 'unknown')
            num_media = int(request.form.get('NumMedia', '0'))
            media_content_type = request.form.get('MediaContentType0', '') if num_media > 0 else ''

            # Loga o MessageSid para identificar duplicatas
            logger.info(f"📬 MessageSid: {message_id}")
            
            # Validação crítica
            if not user_number:
                logger.error("📵 Número não recebido")
                twiml_response = (
                    '<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<Response>\n'
                    '    <Message>⚠️ Erro: Número do contato não identificado.</Message>\n'
                    '</Response>'
                )
                return Response(twiml_response, mimetype='text/xml'), 400

            # Verifica se a mensagem contém mídia (áudio ou foto)
            if num_media > 0:
                logger.info(f"📸🎙️ Mídia detectada: {media_content_type}")
                twiml_response = (
                    '<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<Response>\n'
                    '    <Message>📢 Estamos trabalhando para processar imagens e áudios! 🚀 Essa funcionalidade estará disponível em breve. Enquanto isso, envie sua mensagem em texto, por favor! 😊</Message>\n'
                    '</Response>'
                )
                return Response(twiml_response, mimetype='text/xml'), 200

            # Valida mensagem de texto
            if not user_message:
                logger.error("📝 Mensagem vazia recebida")
                twiml_response = (
                    '<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<Response>\n'
                    '    <Message>⚠️ Por favor, envie uma mensagem válida.</Message>\n'
                    '</Response>'
                )
                return Response(twiml_response, mimetype='text/xml'), 400

            # Verifica se podemos usar IA (OpenAI + Supabase configurados)
            ia_configured = openai.api_key and supabase_url and supabase_key
            
            if ia_configured:
                logger.info("🤖 Processando com IA...")
                # Processa com IA primeiro
                resposta_ia = processar_com_ia(user_number, user_message)
                
                if resposta_ia:
                    # Monta resposta TwiML com a resposta da IA
                    twiml_response = (
                        '<?xml version="1.0" encoding="UTF-8"?>\n'
                        '<Response>\n'
                        f'    <Message>{resposta_ia}</Message>\n'
                        '</Response>'
                    )
                    logger.info(f"⏱️ Tempo total de processamento com IA: {time.time() - start_time:.2f} segundos")
                    return Response(twiml_response, mimetype='text/xml'), 200
            
            # Fallback para Dialogflow se IA não estiver configurada ou falhar
            logger.info("🔁 Usando Dialogflow como fallback...")
            
            # Gera um session_id único para o Dialogflow
            session_id = user_number.replace('whatsapp:', '').replace('+', '')
            
            # Monta a requisição para o Dialogflow
            headers = {
                'Authorization': f'Bearer {DIALOGFLOW_TOKEN}',
                'Content-Type': 'application/json'
            }
            payload = {
                'queryInput': {
                    'text': {
                        'text': user_message,
                        'languageCode': 'pt-BR'
                    }
                }
            }
            
            # Faz a requisição ao Dialogflow
            response = requests.post(
                DIALOGFLOW_URL.format(session_id=session_id),
                headers=headers,
                json=payload
            )
            
            if response.status_code != 200:
                logger.error(f"🔥 Erro ao chamar Dialogflow: {response.status_code} - {response.text}")
                twiml_response = (
                    '<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<Response>\n'
                    '    <Message>⚠️ Erro ao processar sua mensagem. Tente novamente mais tarde.</Message>\n'
                    '</Response>'
                )
                return Response(twiml_response, mimetype='text/xml'), 500
            
            query_result = response.json().get('queryResult', {})
            logger.info(f"🤖 Resposta do Dialogflow: {query_result}")
            
            # Processa a resposta do Dialogflow
            result = handle_dialogflow_response_fallback(query_result, user_number, message_id, user_message)
            fulfillment_text = result.get('fulfillmentText', 'Desculpe, não entendi sua mensagem.')
            
            # Monta resposta TwiML
            twiml_response = (
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<Response>\n'
                f'    <Message>{fulfillment_text}</Message>\n'
                '</Response>'
            )
            
            logger.info(f"⏱️ Tempo total de processamento com Dialogflow: {time.time() - start_time:.2f} segundos")
            return Response(twiml_response, mimetype='text/xml'), 200
        
        # Processa requisições JSON (para testes ou outras integrações)
        else:
            data = request.get_json()
            logger.info(f"📥 Dados JSON recebidos: {data}")
            
            # Simula processamento para requisições JSON
            if data and 'message' in data:
                user_number = data.get('number', 'test_user')
                user_message = data['message']
                
                # Tenta processar com IA se configurada
                ia_configured = openai.api_key and supabase_url and supabase_key
                if ia_configured:
                    resposta_ia = processar_com_ia(user_number, user_message)
                    if resposta_ia:
                        return jsonify({'response': resposta_ia, 'processed_with': 'IA'}), 200
                
                # Fallback para simulação de Dialogflow
                return jsonify({
                    'response': f"Processado: {user_message}",
                    'processed_with': 'Dialogflow (simulado)'
                }), 200
            
            return jsonify({'status': 'received', 'data': data}), 200

    except Exception as e:
        logger.error(f"🔥 Erro no webhook: {str(e)}")
        twiml_response = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            '    <Message>⚠️ Ocorreu um erro interno. Tente novamente mais tarde.</Message>\n'
            '</Response>'
        )
        return Response(twiml_response, mimetype='text/xml'), 500
    finally:
        logger.info(f"⏱️ Tempo total de processamento do webhook: {time.time() - start_time:.2f} segundos")
        
# === SEÇÃO 10: INICIALIZAÇÃO DO AGENDAMENTO (Melhorada e segura) ===
import os
import schedule
import time
from threading import Thread
import atexit
from datetime import datetime

# Tags usados para identificar jobs e evitar duplicação
_TAG_DAILY_RECURRING = "daily-recurring"
_TAG_CLEAN_DAILY = "clean-daily"
_TAG_WEEKLY_REPORT = "weekly-report"
_TAG_MONTHLY_REPORT = "monthly-report"
_TAG_BACKUP_HEALTH = "backup-health"
_TAG_RETRY_WEEKLY = "retry-weekly"
_TAG_RETRY_MONTHLY = "retry-monthly"

def run_scheduler(poll_interval: float = 1.0):
    """Executa o agendador em thread separada. poll_interval em segundos."""
    logger.info("⏰ Iniciando agendador de tarefas (thread SchedulerThread)...")
    while True:
        try:
            schedule.run_pending()
            time.sleep(poll_interval)
        except Exception as e:
            logger.error(f"🔥 Erro no laço do agendador: {e}", exc_info=True)
            # espera maior para evitar loop rápido em erro
            time.sleep(60)

def generate_weekly_report_job():
    """Gera relatórios semanais (job)."""
    try:
        logger.info("📊 [job] Geração de relatórios semanais iniciada")
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=CONTROL_SPREADSHEET_ID,
            range='Controle!A:B'
        ).execute()
        values = result.get('values', [])
        if not values or len(values) <= 1:
            logger.info("📋 Nenhum contato na planilha de controle (seção semanal).")
            return

        for row in values[1:]:
            if not row:
                continue
            contact_number = row[0]
            logger.info(f"📊 [job] Gerando relatório semanal para {contact_number}")
            if can_send_message():
                try:
                    generate_report(contact_number, 'Semanal')
                except Exception as e:
                    logger.error(f"Erro ao gerar relatório para {contact_number}: {e}", exc_info=True)
            else:
                logger.warning(f"⚠️ Limite diário atingido; agendando retry horário para {contact_number}")
                schedule.clear(_TAG_RETRY_WEEKLY)
                schedule.every().hour.do(generate_weekly_report_job).tag(_TAG_RETRY_WEEKLY)
                break
        logger.info("✅ [job] Geração de relatórios semanais finalizada")
    except Exception as e:
        logger.exception(f"🔥 Erro crítico em generate_weekly_report_job: {e}")
        schedule.clear(_TAG_RETRY_WEEKLY)
        schedule.every(2).hours.do(generate_weekly_report_job).tag(_TAG_RETRY_WEEKLY)

def generate_monthly_report_job():
    """Gera relatórios mensais (job executado diariamente para checar dia 1)."""
    try:
        # Usa BRASILIA_TZ se existir no escopo global; fallback para local
        try:
            today = datetime.now(BRASILIA_TZ)
        except Exception:
            today = datetime.now()
        if today.day != 1:
            logger.info("📅 Hoje não é dia 1º; pulando job mensal.")
            return

        logger.info("📊 [job] Iniciando geração de relatórios mensais")
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=CONTROL_SPREADSHEET_ID,
            range='Controle!A:B'
        ).execute()
        values = result.get('values', [])
        if not values or len(values) <= 1:
            logger.info("📋 Nenhum contato na planilha de controle (seção mensal).")
            return

        for row in values[1:]:
            if not row:
                continue
            contact_number = row[0]
            logger.info(f"📊 [job] Gerando relatório mensal para {contact_number}")
            if can_send_message():
                try:
                    generate_report(contact_number, 'Mensal')
                except Exception as e:
                    logger.error(f"Erro ao gerar relatório mensal para {contact_number}: {e}", exc_info=True)
            else:
                logger.warning(f"⚠️ Limite diário atingido; agendando retry horário para {contact_number}")
                schedule.clear(_TAG_RETRY_MONTHLY)
                schedule.every().hour.do(generate_monthly_report_job).tag(_TAG_RETRY_MONTHLY)
                break
        logger.info("✅ [job] Geração de relatórios mensais finalizada")
    except Exception as e:
        logger.exception(f"🔥 Erro crítico em generate_monthly_report_job: {e}")
        schedule.clear(_TAG_RETRY_MONTHLY)
        schedule.every(3).hours.do(generate_monthly_report_job).tag(_TAG_RETRY_MONTHLY)

def clean_daily_counts_job():
    """Limpa os contadores diários de mensagens (job)."""
    try:
        logger.info("🧹 [job] Limpando contadores diários de mensagens")
        clean_old_message_counts()
        logger.info("✅ [job] Contadores limpos")
    except Exception as e:
        logger.exception(f"🔥 Erro ao limpar contadores diários: {e}")

def backup_health_check():
    """Verificação de saúde dos serviços (job)."""
    try:
        logger.info("🩺 [job] Verificação de saúde dos serviços iniciada")
        sheets_service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        sheets_service.spreadsheets().get(spreadsheetId=CONTROL_SPREADSHEET_ID).execute()
        if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
            twilio_client.messages.list(limit=1)
        logger.info("✅ [job] Serviços saudáveis")
    except Exception as e:
        logger.warning(f"⚠️ Verificação de saúde detectou problema: {e}", exc_info=True)

def register_scheduler_jobs():
    """Registra jobs com tags (idempotente)."""
    # limpa apenas nossas tags para evitar duplicação
    schedule.clear(_TAG_DAILY_RECURRING)
    schedule.clear(_TAG_CLEAN_DAILY)
    schedule.clear(_TAG_WEEKLY_REPORT)
    schedule.clear(_TAG_MONTHLY_REPORT)
    schedule.clear(_TAG_BACKUP_HEALTH)

    # Registra jobs principais com tags
    schedule.every().day.at("00:00").do(process_recurring_expenses).tag(_TAG_DAILY_RECURRING)
    schedule.every().day.at("00:05").do(clean_daily_counts_job).tag(_TAG_CLEAN_DAILY)
    schedule.every().monday.at("08:00").do(generate_weekly_report_job).tag(_TAG_WEEKLY_REPORT)
    # agendamos check diário às 08:00 que executa a checagem "se é dia 1"
    schedule.every().day.at("08:00").do(generate_monthly_report_job).tag(_TAG_MONTHLY_REPORT)
    schedule.every(6).hours.do(backup_health_check).tag(_TAG_BACKUP_HEALTH)
    logger.info("🗓️ Jobs registrados no agendador com tags.")

def stop_scheduler():
    """Para o agendador de forma controlada."""
    logger.info("🛑 Parando agendador de tarefas...")
    # remove somente nossas tags para não afetar outros jobs
    schedule.clear(_TAG_DAILY_RECURRING)
    schedule.clear(_TAG_CLEAN_DAILY)
    schedule.clear(_TAG_WEEKLY_REPORT)
    schedule.clear(_TAG_MONTHLY_REPORT)
    schedule.clear(_TAG_BACKUP_HEALTH)
    schedule.clear(_TAG_RETRY_WEEKLY)
    schedule.clear(_TAG_RETRY_MONTHLY)

# Registro de parada na saída do processo
atexit.register(stop_scheduler)

# Controle de inicialização: NÃO iniciamos o thread automaticamente em todos os ambientes
# Use a variável de ambiente START_SCHEDULER=true para habilitar o agendador neste processo.
# Isso evita múltiplas threads quando o app é executada por Gunicorn com múltiplos workers.
_start_scheduler_env = os.getenv("START_SCHEDULER", "false").lower() in ("1", "true", "yes")

_scheduler_thread = None

if _start_scheduler_env:
    try:
        register_scheduler_jobs()
        # Proteção: só cria thread se ainda não houver uma
        if not globals().get("_scheduler_thread") or not globals()["_scheduler_thread"] or not globals()["_scheduler_thread"].is_alive():
            _scheduler_thread = Thread(target=run_scheduler, daemon=True, name="SchedulerThread")
            _scheduler_thread.start()
            globals()["_scheduler_thread"] = _scheduler_thread
            logger.info("⏰ Agendador iniciado (START_SCHEDULER=true)")
    except Exception as e:
        logger.exception(f"Falha ao iniciar agendador: {e}")
else:
    logger.info("Agendador não iniciado automaticamente. Defina START_SCHEDULER=true para ativar (recomendado em um processo/instance dedicada).")

# Logs de resumo das tarefas programadas (para facilitar debugging)
try:
    jobs = schedule.jobs
    logger.info(f"📅 Tarefas atualmente registradas no schedule: {len(jobs)}")
    for j in jobs:
        logger.debug(f" - job: {j} (tags: {getattr(j, 'tags', None)})")
except Exception:
    pass
